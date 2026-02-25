import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BIN = path.resolve(__dirname, 'cuda/bin/wave_sim');
const BIN_PATH = process.env.HOMELAND_GPU_WAVE_BIN || DEFAULT_BIN;

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, ms);
}

function encodeWaveInput(payload) {
  const parts = [];
  parts.push('HWV1');
  parts.push(String(payload.coins));
  parts.push(String(payload.xp));
  parts.push(String(payload.leakCoins));
  parts.push(String(payload.leakXp));
  parts.push(String(payload.dt));
  parts.push(String(payload.spawnInterval));

  parts.push(String(payload.routes.length));
  for (const route of payload.routes) {
    parts.push(String(route.length));
    for (const point of route) {
      parts.push(String(point.x));
      parts.push(String(point.y));
    }
  }

  parts.push(String(payload.enemyQueue.length));
  for (const enemy of payload.enemyQueue) {
    parts.push(String(enemy.hp));
    parts.push(String(enemy.speed));
    parts.push(String(enemy.coinReward));
    parts.push(String(enemy.xpReward));
    parts.push(String(enemy.routeIndex));
  }

  parts.push(String(payload.towers.length));
  for (const tower of payload.towers) {
    parts.push(String(tower.slotIndex));
    parts.push(String(tower.type));
    parts.push(String(tower.x));
    parts.push(String(tower.y));
    parts.push(String(tower.cooldown));
    parts.push(String(tower.range));
    parts.push(String(tower.attackSpeed));
    parts.push(String(tower.damage));
    parts.push(String(tower.splashRadius));
    parts.push(String(tower.splashFalloff));
    parts.push(String(tower.burnDps));
    parts.push(String(tower.burnDuration));
    parts.push(String(tower.fireballRadius));
    parts.push(String(tower.fireballDps));
    parts.push(String(tower.fireballDuration));
    parts.push(String(tower.slowPercent));
    parts.push(String(tower.slowDuration));
    parts.push(String(tower.windTargets));
    parts.push(String(tower.chainCount));
    parts.push(String(tower.chainFalloff));
    parts.push(String(tower.shockDuration));
  }

  parts.push(String(payload.fireZones.length));
  for (const zone of payload.fireZones) {
    parts.push(String(zone.x));
    parts.push(String(zone.y));
    parts.push(String(zone.radius));
    parts.push(String(zone.dps));
    parts.push(String(zone.duration));
  }

  parts.push('END');
  return Buffer.from(`${parts.join(' ')}\n`, 'utf8');
}

function parseWaveOutput(raw) {
  const tokens = String(raw).trim().split(/\s+/);
  let idx = 0;
  const next = () => tokens[idx++];
  const nextNum = () => Number(next());

  const status = next();
  if (status !== 'OK') {
    throw new Error(`Invalid GPU wave output status: ${status || '<empty>'}`);
  }

  const coins = nextNum();
  const xp = nextNum();
  const leaked = Math.round(nextNum());
  const killed = Math.round(nextNum());
  const towerCount = Math.round(nextNum());
  const fireCount = Math.round(nextNum());
  const defeat = Math.round(nextNum()) === 1;

  const towerCooldowns = [];
  for (let i = 0; i < towerCount; i += 1) {
    towerCooldowns.push({
      slotIndex: Math.round(nextNum()),
      cooldown: nextNum(),
    });
  }

  const fireZones = [];
  for (let i = 0; i < fireCount; i += 1) {
    fireZones.push({
      x: nextNum(),
      y: nextNum(),
      radius: nextNum(),
      dps: nextNum(),
      duration: nextNum(),
    });
  }

  return {
    coins,
    xp,
    leaked,
    killed,
    defeat,
    towerCooldowns,
    fireZones,
  };
}

class PersistentWaveProcess {
  constructor(binPath) {
    this.binPath = binPath;
    this.proc = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.stdinFd = this.proc.stdin?._handle?.fd;
    this.stdoutFd = this.proc.stdout?._handle?.fd;
    this.readRemainder = Buffer.alloc(0);
    this.exited = false;

    this.proc.on('exit', () => {
      this.exited = true;
    });

    if (!Number.isInteger(this.stdinFd) || !Number.isInteger(this.stdoutFd)) {
      throw new Error('Failed to open GPU wave simulator stdio handles.');
    }
  }

  writeAll(buffer) {
    let offset = 0;
    while (offset < buffer.length) {
      try {
        const written = fs.writeSync(this.stdinFd, buffer, offset, buffer.length - offset);
        offset += written;
      } catch (error) {
        if (error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK') {
          sleepMs(1);
          continue;
        }
        throw error;
      }
    }
  }

  readChunk() {
    const chunk = Buffer.allocUnsafe(4096);
    while (true) {
      try {
        const n = fs.readSync(this.stdoutFd, chunk, 0, chunk.length, null);
        if (n === 0) {
          throw new Error('GPU wave simulator closed stdout unexpectedly.');
        }
        return chunk.subarray(0, n);
      } catch (error) {
        if (error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK') {
          sleepMs(1);
          continue;
        }
        throw error;
      }
    }
  }

  readLine() {
    while (true) {
      const newlineIndex = this.readRemainder.indexOf(0x0a);
      if (newlineIndex >= 0) {
        const line = this.readRemainder.subarray(0, newlineIndex);
        this.readRemainder = this.readRemainder.subarray(newlineIndex + 1);
        return line.toString('utf8');
      }

      const chunk = this.readChunk();
      this.readRemainder = this.readRemainder.length === 0
        ? chunk
        : Buffer.concat([this.readRemainder, chunk]);
    }
  }

  run(payload) {
    if (this.exited) {
      throw new Error('GPU wave simulator process is not running.');
    }
    this.writeAll(encodeWaveInput(payload));
    const line = this.readLine();
    return parseWaveOutput(line);
  }
}

let PROCESS = null;

function getProcess() {
  if (PROCESS && !PROCESS.exited) {
    return PROCESS;
  }
  PROCESS = new PersistentWaveProcess(BIN_PATH);
  return PROCESS;
}

export function hasGpuWaveBinary() {
  return fs.existsSync(BIN_PATH);
}

export function runGpuWave(payload) {
  if (!hasGpuWaveBinary()) {
    throw new Error(`GPU wave simulator binary not found at ${BIN_PATH}. Run ./scripts/build-gpu-wave-sim.sh on GS75.`);
  }
  const proc = getProcess();
  return proc.run(payload);
}

export function gpuWaveBinaryPath() {
  return BIN_PATH;
}
