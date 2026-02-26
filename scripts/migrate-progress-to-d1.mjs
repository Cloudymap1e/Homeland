import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    input: '.data/player-progress.json',
    outSql: '.data/d1-progress-migration.sql',
    db: '',
    apply: false,
    truncate: false,
    verify: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      args.input = arg.slice('--input='.length);
    } else if (arg.startsWith('--out-sql=')) {
      args.outSql = arg.slice('--out-sql='.length);
    } else if (arg.startsWith('--db=')) {
      args.db = arg.slice('--db='.length);
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--truncate') {
      args.truncate = true;
    } else if (arg === '--verify') {
      args.verify = true;
    }
  }

  if (args.apply && !args.verify) {
    args.verify = true;
  }

  return args;
}

function sqlString(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  const raw = String(value).replaceAll("'", "''");
  return `'${raw}'`;
}

function fingerprintRows(rows) {
  const content = rows
    .map((row) => `${row.session_id}:${row.progress_json}`)
    .join('\n');
  return createHash('sha256').update(content).digest('hex');
}

function extractWranglerRows(payload) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (Array.isArray(item?.results)) {
        return item.results;
      }
      if (Array.isArray(item?.result)) {
        return item.result;
      }
    }
    return [];
  }
  if (Array.isArray(payload.results)) {
    return payload.results;
  }
  if (Array.isArray(payload.result)) {
    return payload.result;
  }
  return [];
}

async function runCommand(cmd, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectRun(new Error(`${cmd} ${args.join(' ')} failed (${code})\n${stderr || stdout}`));
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

async function wranglerQuery(db, sql) {
  const { stdout } = await runCommand('npx', ['wrangler', 'd1', 'execute', db, '--command', sql, '--json']);
  const parsed = JSON.parse(stdout);
  return extractWranglerRows(parsed);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(args.input);
  const outSqlPath = resolve(args.outSql);

  const raw = await readFile(inputPath, 'utf8');
  const store = JSON.parse(raw);
  const sessions = store?.sessions && typeof store.sessions === 'object' ? store.sessions : {};
  const ipIndex = store?.ipIndex && typeof store.ipIndex === 'object' ? store.ipIndex : {};
  const sessionIds = Object.keys(sessions).sort();
  const ips = Object.keys(ipIndex).sort();

  const sqlLines = [];
  sqlLines.push('PRAGMA foreign_keys = ON;');
  sqlLines.push('BEGIN;');
  if (args.truncate) {
    sqlLines.push('DELETE FROM ip_index;');
    sqlLines.push('DELETE FROM sessions;');
  }

  for (const sessionId of sessionIds) {
    const session = sessions[sessionId] || {};
    const createdAt = session.createdAt || new Date().toISOString();
    const updatedAt = session.updatedAt || createdAt;
    const lastIp = session.lastIp || null;
    const progressJson = JSON.stringify(session.progress ?? null);
    sqlLines.push(
      'INSERT INTO sessions (session_id, created_at, updated_at, last_ip, progress_json) VALUES (' +
      `${sqlString(sessionId)}, ${sqlString(createdAt)}, ${sqlString(updatedAt)}, ${sqlString(lastIp)}, ${sqlString(progressJson)}` +
      ') ON CONFLICT(session_id) DO UPDATE SET ' +
      'created_at = excluded.created_at, updated_at = excluded.updated_at, last_ip = excluded.last_ip, progress_json = excluded.progress_json;'
    );
  }

  for (const ip of ips) {
    const sessionId = ipIndex[ip];
    if (!sessionId || !(sessionId in sessions)) {
      continue;
    }
    const updatedAt = sessions[sessionId]?.updatedAt || new Date().toISOString();
    sqlLines.push(
      'INSERT INTO ip_index (ip, session_id, updated_at) VALUES (' +
      `${sqlString(ip)}, ${sqlString(sessionId)}, ${sqlString(updatedAt)}` +
      ') ON CONFLICT(ip) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at;'
    );
  }

  sqlLines.push('COMMIT;');
  sqlLines.push('');

  await mkdir(dirname(outSqlPath), { recursive: true });
  await writeFile(outSqlPath, sqlLines.join('\n'), 'utf8');

  const sampleIds = sessionIds.slice(0, 5);
  const sourceSampleRows = sampleIds.map((id) => ({
    session_id: id,
    progress_json: JSON.stringify(sessions[id]?.progress ?? null),
  }));
  const sourceSummary = {
    sessionCount: sessionIds.length,
    ipIndexCount: ips.length,
    sampleIds,
    sampleFingerprint: fingerprintRows(sourceSampleRows),
  };

  console.log('[migrate] SQL written to', outSqlPath);
  console.log('[migrate] Source summary', sourceSummary);

  if (!args.apply) {
    console.log('[migrate] Dry run complete. Use --apply --db=<D1_DATABASE_NAME> to execute.');
    return;
  }

  if (!args.db) {
    throw new Error('Missing --db=<D1_DATABASE_NAME> for apply mode.');
  }

  await runCommand('npx', ['wrangler', 'd1', 'execute', args.db, '--file', outSqlPath]);
  console.log('[migrate] Applied SQL to D1 database', args.db);

  if (!args.verify) {
    return;
  }

  const sessionRows = await wranglerQuery(args.db, 'SELECT COUNT(*) AS count FROM sessions;');
  const ipRows = await wranglerQuery(args.db, 'SELECT COUNT(*) AS count FROM ip_index;');
  const targetSessionCount = Number(sessionRows[0]?.count || 0);
  const targetIpCount = Number(ipRows[0]?.count || 0);

  let targetFingerprint = '';
  if (sampleIds.length > 0) {
    const inClause = sampleIds.map((id) => sqlString(id)).join(', ');
    const sampleRows = await wranglerQuery(
      args.db,
      `SELECT session_id, progress_json FROM sessions WHERE session_id IN (${inClause}) ORDER BY session_id;`
    );
    targetFingerprint = fingerprintRows(sampleRows);
  }

  const verification = {
    sourceSessionCount: sourceSummary.sessionCount,
    targetSessionCount,
    sourceIpIndexCount: sourceSummary.ipIndexCount,
    targetIpIndexCount: targetIpCount,
    sourceSampleFingerprint: sourceSummary.sampleFingerprint,
    targetSampleFingerprint: targetFingerprint,
    ok:
      targetSessionCount === sourceSummary.sessionCount &&
      targetIpCount === sourceSummary.ipIndexCount &&
      (sampleIds.length === 0 || targetFingerprint === sourceSummary.sampleFingerprint),
  };

  console.log('[migrate] Verification', verification);
  if (!verification.ok) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
