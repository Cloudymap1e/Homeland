#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

#include <cuda_runtime.h>

namespace {

constexpr float WORLD_SCALE = 10.0f;
constexpr float CHAIN_RADIUS = 2.6f;
constexpr int MAX_GUARD = 500000;

struct Point {
  float x;
  float y;
};

struct Segment {
  float ax;
  float ay;
  float dx;
  float dy;
  float len;
};

struct Route {
  std::vector<Point> points;
  std::vector<Segment> segments;
  float length = 0.0f;
};

struct EnemySpawn {
  float hp = 0.0f;
  float speed = 0.0f;
  int coin = 0;
  int xp = 0;
  int routeIndex = 0;
};

struct Enemy {
  float hp = 0.0f;
  float maxHp = 0.0f;
  float speed = 0.0f;
  int coin = 0;
  int xp = 0;
  float distance = 0.0f;
  int routeIndex = 0;
  float routeLength = 0.0f;
  float burnDps = 0.0f;
  float burnDuration = 0.0f;
  float slowPercent = 0.0f;
  float slowDuration = 0.0f;
  float shockDuration = 0.0f;
  float x = 0.0f;
  float y = 0.0f;
};

struct FireZone {
  float x = 0.0f;
  float y = 0.0f;
  float radius = 0.0f;
  float dps = 0.0f;
  float duration = 0.0f;
};

// 0 arrow, 1 bomb, 2 fire, 3 wind, 4 lightning
struct Tower {
  int slotIndex = 0;
  int type = 0;
  float x = 0.0f;
  float y = 0.0f;
  float cooldown = 0.0f;
  float range = 0.0f;
  float attackSpeed = 0.0f;
  float damage = 0.0f;
  float splashRadius = 0.0f;
  float splashFalloff = 0.0f;
  float burnDps = 0.0f;
  float burnDuration = 0.0f;
  float fireballRadius = 0.0f;
  float fireballDps = 0.0f;
  float fireballDuration = 0.0f;
  float slowPercent = 0.0f;
  float slowDuration = 0.0f;
  int windTargets = 1;
  int chainCount = 0;
  float chainFalloff = 0.0f;
  float shockDuration = 0.0f;
};

struct WaveInput {
  float coins = 0.0f;
  float xp = 0.0f;
  float leakCoins = 0.0f;
  float leakXp = 0.0f;
  float dt = 0.06f;
  float spawnInterval = 0.8f;
  std::vector<Route> routes;
  std::vector<EnemySpawn> queue;
  std::vector<Tower> towers;
  std::vector<FireZone> fireZones;
};

struct WaveOutput {
  float coins = 0.0f;
  float xp = 0.0f;
  int leaked = 0;
  int killed = 0;
  int defeat = 0;
  std::vector<std::pair<int, float>> towerCooldowns;
  std::vector<FireZone> fireZones;
};

float distance(Point a, Point b) {
  const float dx = a.x - b.x;
  const float dy = a.y - b.y;
  return std::sqrt(dx * dx + dy * dy);
}

Point positionAtDistance(const Route& route, float dist) {
  if (route.points.empty()) {
    return {0.0f, 0.0f};
  }
  if (dist <= 0.0f) {
    return route.points.front();
  }
  if (dist >= route.length) {
    return route.points.back();
  }

  float remaining = dist;
  for (const Segment& seg : route.segments) {
    if (remaining <= seg.len) {
      const float t = seg.len <= 0.0f ? 0.0f : remaining / seg.len;
      return {seg.ax + seg.dx * t, seg.ay + seg.dy * t};
    }
    remaining -= seg.len;
  }

  return route.points.back();
}

std::vector<int> topTargetsInRange(
  const std::vector<Enemy>& enemies,
  float towerX,
  float towerY,
  float range,
  int maxTargets
) {
  struct Candidate {
    int index;
    float progress;
  };
  std::vector<Candidate> inRange;
  inRange.reserve(enemies.size());
  for (int i = 0; i < static_cast<int>(enemies.size()); i += 1) {
    if (enemies[i].hp <= 0.0f) {
      continue;
    }
    const float dx = (towerX - enemies[i].x) * WORLD_SCALE;
    const float dy = (towerY - enemies[i].y) * WORLD_SCALE;
    const float d = std::sqrt(dx * dx + dy * dy);
    if (d > range) {
      continue;
    }
    const float progress = enemies[i].routeLength <= 0.0f
      ? 0.0f
      : enemies[i].distance / enemies[i].routeLength;
    inRange.push_back({i, progress});
  }
  std::sort(inRange.begin(), inRange.end(), [](const Candidate& a, const Candidate& b) {
    return a.progress > b.progress;
  });
  std::vector<int> out;
  out.reserve(maxTargets);
  for (int i = 0; i < static_cast<int>(inRange.size()) && i < maxTargets; i += 1) {
    out.push_back(inRange[i].index);
  }
  return out;
}

__global__ void selectTargetsKernel(
  const float* towerX,
  const float* towerY,
  const float* towerRange,
  const int* canFire,
  int towerCount,
  const float* enemyX,
  const float* enemyY,
  const float* enemyProgress,
  const float* enemyHp,
  int enemyCount,
  int* outTarget
) {
  const int tid = blockIdx.x * blockDim.x + threadIdx.x;
  if (tid >= towerCount) {
    return;
  }
  if (!canFire[tid]) {
    outTarget[tid] = -1;
    return;
  }

  const float tx = towerX[tid];
  const float ty = towerY[tid];
  const float tr = towerRange[tid];

  int bestIndex = -1;
  float bestProgress = -1.0f;

  for (int i = 0; i < enemyCount; i += 1) {
    if (enemyHp[i] <= 0.0f) {
      continue;
    }
    const float dx = (tx - enemyX[i]) * WORLD_SCALE;
    const float dy = (ty - enemyY[i]) * WORLD_SCALE;
    const float d = sqrtf(dx * dx + dy * dy);
    if (d > tr) {
      continue;
    }
    const float progress = enemyProgress[i];
    if (progress > bestProgress) {
      bestProgress = progress;
      bestIndex = i;
    }
  }

  outTarget[tid] = bestIndex;
}

__global__ void accumulateDamageKernel(
  const int* towerType,
  const int* canFire,
  const int* target,
  const float* towerDamage,
  int towerCount,
  float* enemyDamage,
  int enemyCount
) {
  const int tid = blockIdx.x * blockDim.x + threadIdx.x;
  if (tid >= towerCount) {
    return;
  }
  if (!canFire[tid]) {
    return;
  }
  // Wind tower is handled on CPU for multi-target behavior.
  if (towerType[tid] == 3) {
    return;
  }
  const int targetIndex = target[tid];
  if (targetIndex < 0 || targetIndex >= enemyCount) {
    return;
  }
  atomicAdd(&enemyDamage[targetIndex], towerDamage[tid]);
}

bool checkCuda(cudaError_t code, const char* context) {
  if (code == cudaSuccess) {
    return true;
  }
  std::cerr << "CUDA error at " << context << ": " << cudaGetErrorString(code) << "\n";
  return false;
}

class GpuContext {
 public:
  ~GpuContext() {
    release();
  }

  bool ensure(int towers, int enemies) {
    if (towers > towerCap_) {
      if (!resizeTowers(towers)) {
        return false;
      }
    }
    if (enemies > enemyCap_) {
      if (!resizeEnemies(enemies)) {
        return false;
      }
    }
    return true;
  }

  bool run(
    const std::vector<Tower>& towers,
    const std::vector<int>& canFire,
    const std::vector<Enemy>& enemies,
    std::vector<int>& outTarget,
    std::vector<float>& outDamage
  ) {
    const int towerCount = static_cast<int>(towers.size());
    const int enemyCount = static_cast<int>(enemies.size());

    if (!ensure(std::max(1, towerCount), std::max(1, enemyCount))) {
      return false;
    }

    hostTowerX_.resize(towerCount);
    hostTowerY_.resize(towerCount);
    hostTowerRange_.resize(towerCount);
    hostTowerDamage_.resize(towerCount);
    hostTowerType_.resize(towerCount);
    hostCanFire_.resize(towerCount);

    for (int i = 0; i < towerCount; i += 1) {
      hostTowerX_[i] = towers[i].x;
      hostTowerY_[i] = towers[i].y;
      hostTowerRange_[i] = towers[i].range;
      hostTowerDamage_[i] = towers[i].damage;
      hostTowerType_[i] = towers[i].type;
      hostCanFire_[i] = canFire[i];
    }

    hostEnemyX_.resize(enemyCount);
    hostEnemyY_.resize(enemyCount);
    hostEnemyProgress_.resize(enemyCount);
    hostEnemyHp_.resize(enemyCount);

    for (int i = 0; i < enemyCount; i += 1) {
      hostEnemyX_[i] = enemies[i].x;
      hostEnemyY_[i] = enemies[i].y;
      hostEnemyHp_[i] = enemies[i].hp;
      hostEnemyProgress_[i] = enemies[i].routeLength <= 0.0f
        ? 0.0f
        : enemies[i].distance / enemies[i].routeLength;
    }

    outTarget.assign(towerCount, -1);
    outDamage.assign(enemyCount, 0.0f);

    if (towerCount == 0 || enemyCount == 0) {
      return true;
    }

    if (!checkCuda(cudaMemcpy(dTowerX_, hostTowerX_.data(), sizeof(float) * towerCount, cudaMemcpyHostToDevice), "copy towerX")) return false;
    if (!checkCuda(cudaMemcpy(dTowerY_, hostTowerY_.data(), sizeof(float) * towerCount, cudaMemcpyHostToDevice), "copy towerY")) return false;
    if (!checkCuda(cudaMemcpy(dTowerRange_, hostTowerRange_.data(), sizeof(float) * towerCount, cudaMemcpyHostToDevice), "copy towerRange")) return false;
    if (!checkCuda(cudaMemcpy(dTowerDamage_, hostTowerDamage_.data(), sizeof(float) * towerCount, cudaMemcpyHostToDevice), "copy towerDamage")) return false;
    if (!checkCuda(cudaMemcpy(dTowerType_, hostTowerType_.data(), sizeof(int) * towerCount, cudaMemcpyHostToDevice), "copy towerType")) return false;
    if (!checkCuda(cudaMemcpy(dCanFire_, hostCanFire_.data(), sizeof(int) * towerCount, cudaMemcpyHostToDevice), "copy canFire")) return false;

    if (!checkCuda(cudaMemcpy(dEnemyX_, hostEnemyX_.data(), sizeof(float) * enemyCount, cudaMemcpyHostToDevice), "copy enemyX")) return false;
    if (!checkCuda(cudaMemcpy(dEnemyY_, hostEnemyY_.data(), sizeof(float) * enemyCount, cudaMemcpyHostToDevice), "copy enemyY")) return false;
    if (!checkCuda(cudaMemcpy(dEnemyProgress_, hostEnemyProgress_.data(), sizeof(float) * enemyCount, cudaMemcpyHostToDevice), "copy enemyProgress")) return false;
    if (!checkCuda(cudaMemcpy(dEnemyHp_, hostEnemyHp_.data(), sizeof(float) * enemyCount, cudaMemcpyHostToDevice), "copy enemyHp")) return false;

    if (!checkCuda(cudaMemset(dEnemyDamage_, 0, sizeof(float) * enemyCount), "clear enemyDamage")) return false;

    const int block = 128;
    const int towerGrid = (towerCount + block - 1) / block;

    selectTargetsKernel<<<towerGrid, block>>>(
      dTowerX_,
      dTowerY_,
      dTowerRange_,
      dCanFire_,
      towerCount,
      dEnemyX_,
      dEnemyY_,
      dEnemyProgress_,
      dEnemyHp_,
      enemyCount,
      dTarget_
    );
    if (!checkCuda(cudaGetLastError(), "selectTargetsKernel launch")) return false;

    accumulateDamageKernel<<<towerGrid, block>>>(
      dTowerType_,
      dCanFire_,
      dTarget_,
      dTowerDamage_,
      towerCount,
      dEnemyDamage_,
      enemyCount
    );
    if (!checkCuda(cudaGetLastError(), "accumulateDamageKernel launch")) return false;

    if (!checkCuda(cudaDeviceSynchronize(), "sync kernels")) return false;

    if (!checkCuda(cudaMemcpy(outTarget.data(), dTarget_, sizeof(int) * towerCount, cudaMemcpyDeviceToHost), "copy outTarget")) return false;
    if (!checkCuda(cudaMemcpy(outDamage.data(), dEnemyDamage_, sizeof(float) * enemyCount, cudaMemcpyDeviceToHost), "copy outDamage")) return false;

    return true;
  }

 private:
  void release() {
    cudaFree(dTowerX_);
    cudaFree(dTowerY_);
    cudaFree(dTowerRange_);
    cudaFree(dTowerDamage_);
    cudaFree(dTowerType_);
    cudaFree(dCanFire_);
    cudaFree(dTarget_);

    cudaFree(dEnemyX_);
    cudaFree(dEnemyY_);
    cudaFree(dEnemyProgress_);
    cudaFree(dEnemyHp_);
    cudaFree(dEnemyDamage_);

    dTowerX_ = nullptr;
    dTowerY_ = nullptr;
    dTowerRange_ = nullptr;
    dTowerDamage_ = nullptr;
    dTowerType_ = nullptr;
    dCanFire_ = nullptr;
    dTarget_ = nullptr;

    dEnemyX_ = nullptr;
    dEnemyY_ = nullptr;
    dEnemyProgress_ = nullptr;
    dEnemyHp_ = nullptr;
    dEnemyDamage_ = nullptr;

    towerCap_ = 0;
    enemyCap_ = 0;
  }

  bool resizeTowers(int newCap) {
    cudaFree(dTowerX_);
    cudaFree(dTowerY_);
    cudaFree(dTowerRange_);
    cudaFree(dTowerDamage_);
    cudaFree(dTowerType_);
    cudaFree(dCanFire_);
    cudaFree(dTarget_);

    dTowerX_ = nullptr;
    dTowerY_ = nullptr;
    dTowerRange_ = nullptr;
    dTowerDamage_ = nullptr;
    dTowerType_ = nullptr;
    dCanFire_ = nullptr;
    dTarget_ = nullptr;

    if (!checkCuda(cudaMalloc(&dTowerX_, sizeof(float) * newCap), "malloc dTowerX")) return false;
    if (!checkCuda(cudaMalloc(&dTowerY_, sizeof(float) * newCap), "malloc dTowerY")) return false;
    if (!checkCuda(cudaMalloc(&dTowerRange_, sizeof(float) * newCap), "malloc dTowerRange")) return false;
    if (!checkCuda(cudaMalloc(&dTowerDamage_, sizeof(float) * newCap), "malloc dTowerDamage")) return false;
    if (!checkCuda(cudaMalloc(&dTowerType_, sizeof(int) * newCap), "malloc dTowerType")) return false;
    if (!checkCuda(cudaMalloc(&dCanFire_, sizeof(int) * newCap), "malloc dCanFire")) return false;
    if (!checkCuda(cudaMalloc(&dTarget_, sizeof(int) * newCap), "malloc dTarget")) return false;

    towerCap_ = newCap;
    return true;
  }

  bool resizeEnemies(int newCap) {
    cudaFree(dEnemyX_);
    cudaFree(dEnemyY_);
    cudaFree(dEnemyProgress_);
    cudaFree(dEnemyHp_);
    cudaFree(dEnemyDamage_);

    dEnemyX_ = nullptr;
    dEnemyY_ = nullptr;
    dEnemyProgress_ = nullptr;
    dEnemyHp_ = nullptr;
    dEnemyDamage_ = nullptr;

    if (!checkCuda(cudaMalloc(&dEnemyX_, sizeof(float) * newCap), "malloc dEnemyX")) return false;
    if (!checkCuda(cudaMalloc(&dEnemyY_, sizeof(float) * newCap), "malloc dEnemyY")) return false;
    if (!checkCuda(cudaMalloc(&dEnemyProgress_, sizeof(float) * newCap), "malloc dEnemyProgress")) return false;
    if (!checkCuda(cudaMalloc(&dEnemyHp_, sizeof(float) * newCap), "malloc dEnemyHp")) return false;
    if (!checkCuda(cudaMalloc(&dEnemyDamage_, sizeof(float) * newCap), "malloc dEnemyDamage")) return false;

    enemyCap_ = newCap;
    return true;
  }

  int towerCap_ = 0;
  int enemyCap_ = 0;

  float* dTowerX_ = nullptr;
  float* dTowerY_ = nullptr;
  float* dTowerRange_ = nullptr;
  float* dTowerDamage_ = nullptr;
  int* dTowerType_ = nullptr;
  int* dCanFire_ = nullptr;
  int* dTarget_ = nullptr;

  float* dEnemyX_ = nullptr;
  float* dEnemyY_ = nullptr;
  float* dEnemyProgress_ = nullptr;
  float* dEnemyHp_ = nullptr;
  float* dEnemyDamage_ = nullptr;

  std::vector<float> hostTowerX_;
  std::vector<float> hostTowerY_;
  std::vector<float> hostTowerRange_;
  std::vector<float> hostTowerDamage_;
  std::vector<int> hostTowerType_;
  std::vector<int> hostCanFire_;

  std::vector<float> hostEnemyX_;
  std::vector<float> hostEnemyY_;
  std::vector<float> hostEnemyProgress_;
  std::vector<float> hostEnemyHp_;
};

bool parseWaveInput(WaveInput& input) {
  std::string magic;
  if (!(std::cin >> magic)) {
    return false;
  }
  if (magic != "HWV1") {
    std::cerr << "Invalid magic token\n";
    return false;
  }

  int routeCount = 0;
  int enemyCount = 0;
  int towerCount = 0;
  int fireCount = 0;

  std::cin >> input.coins >> input.xp >> input.leakCoins >> input.leakXp >> input.dt >> input.spawnInterval;
  std::cin >> routeCount;

  input.routes.clear();
  input.routes.resize(routeCount);

  for (int r = 0; r < routeCount; r += 1) {
    int pointCount = 0;
    std::cin >> pointCount;
    input.routes[r].points.resize(pointCount);
    input.routes[r].segments.clear();
    input.routes[r].length = 0.0f;

    for (int i = 0; i < pointCount; i += 1) {
      std::cin >> input.routes[r].points[i].x >> input.routes[r].points[i].y;
    }

    for (int i = 0; i + 1 < pointCount; i += 1) {
      Point a = input.routes[r].points[i];
      Point b = input.routes[r].points[i + 1];
      const float len = distance(a, b) * WORLD_SCALE;
      input.routes[r].segments.push_back({a.x, a.y, b.x - a.x, b.y - a.y, len});
      input.routes[r].length += len;
    }
  }

  std::cin >> enemyCount;
  input.queue.clear();
  input.queue.resize(enemyCount);
  for (int i = 0; i < enemyCount; i += 1) {
    std::cin
      >> input.queue[i].hp
      >> input.queue[i].speed
      >> input.queue[i].coin
      >> input.queue[i].xp
      >> input.queue[i].routeIndex;
  }

  std::cin >> towerCount;
  input.towers.clear();
  input.towers.resize(towerCount);
  for (int i = 0; i < towerCount; i += 1) {
    Tower& t = input.towers[i];
    std::cin
      >> t.slotIndex
      >> t.type
      >> t.x
      >> t.y
      >> t.cooldown
      >> t.range
      >> t.attackSpeed
      >> t.damage
      >> t.splashRadius
      >> t.splashFalloff
      >> t.burnDps
      >> t.burnDuration
      >> t.fireballRadius
      >> t.fireballDps
      >> t.fireballDuration
      >> t.slowPercent
      >> t.slowDuration
      >> t.windTargets
      >> t.chainCount
      >> t.chainFalloff
      >> t.shockDuration;
  }

  std::cin >> fireCount;
  input.fireZones.clear();
  input.fireZones.resize(fireCount);
  for (int i = 0; i < fireCount; i += 1) {
    std::cin
      >> input.fireZones[i].x
      >> input.fireZones[i].y
      >> input.fireZones[i].radius
      >> input.fireZones[i].dps
      >> input.fireZones[i].duration;
  }

  std::string endToken;
  std::cin >> endToken;
  if (endToken != "END") {
    std::cerr << "Invalid end token\n";
    return false;
  }

  return true;
}

WaveOutput simulateWave(const WaveInput& input) {
  WaveOutput out;
  out.coins = input.coins;
  out.xp = input.xp;

  std::vector<Tower> towers = input.towers;
  std::vector<FireZone> fireZones = input.fireZones;
  std::vector<Enemy> enemies;
  enemies.reserve(input.queue.size() + 32);

  int queueIndex = 0;
  float spawnCooldown = 0.0f;

  GpuContext gpu;
  std::vector<int> canFire;
  std::vector<int> targetIndex;
  std::vector<float> enemyDirectDamage;

  int guard = 0;
  while (guard < MAX_GUARD) {
    // Spawn
    spawnCooldown -= input.dt;
    while (queueIndex < static_cast<int>(input.queue.size()) && spawnCooldown <= 0.0f) {
      const EnemySpawn& sp = input.queue[queueIndex];
      queueIndex += 1;
      spawnCooldown += input.spawnInterval;

      Enemy e;
      e.hp = sp.hp;
      e.maxHp = sp.hp;
      e.speed = sp.speed;
      e.coin = sp.coin;
      e.xp = sp.xp;
      e.distance = 0.0f;
      e.routeIndex = std::max(0, std::min(sp.routeIndex, static_cast<int>(input.routes.size()) - 1));
      e.routeLength = input.routes[e.routeIndex].length;
      const Point p = input.routes[e.routeIndex].points.empty()
        ? Point{0.0f, 0.0f}
        : input.routes[e.routeIndex].points.front();
      e.x = p.x;
      e.y = p.y;
      enemies.push_back(e);
    }

    // Position refresh.
    for (Enemy& e : enemies) {
      const Point p = positionAtDistance(input.routes[e.routeIndex], e.distance);
      e.x = p.x;
      e.y = p.y;
    }

    // Fire zones and status effects.
    for (FireZone& zone : fireZones) {
      zone.duration = std::max(0.0f, zone.duration - input.dt);
      for (Enemy& e : enemies) {
        const float dx = (e.x - zone.x) * WORLD_SCALE;
        const float dy = (e.y - zone.y) * WORLD_SCALE;
        const float d = std::sqrt(dx * dx + dy * dy);
        if (d <= zone.radius) {
          e.hp -= zone.dps * input.dt;
        }
      }
    }
    fireZones.erase(
      std::remove_if(fireZones.begin(), fireZones.end(), [](const FireZone& z) {
        return z.duration <= 0.0f;
      }),
      fireZones.end()
    );

    for (Enemy& e : enemies) {
      if (e.burnDuration > 0.0f) {
        e.hp -= e.burnDps * input.dt;
        e.burnDuration = std::max(0.0f, e.burnDuration - input.dt);
        if (e.burnDuration <= 0.0f) {
          e.burnDps = 0.0f;
        }
      }
      if (e.slowDuration > 0.0f) {
        e.slowDuration = std::max(0.0f, e.slowDuration - input.dt);
        if (e.slowDuration <= 0.0f) {
          e.slowPercent = 0.0f;
        }
      }
      if (e.shockDuration > 0.0f) {
        e.shockDuration = std::max(0.0f, e.shockDuration - input.dt);
      }
    }

    // Remove dead from effects.
    for (int i = static_cast<int>(enemies.size()) - 1; i >= 0; i -= 1) {
      if (enemies[i].hp <= 0.0f) {
        out.coins += enemies[i].coin;
        out.xp += enemies[i].xp;
        out.killed += 1;
        enemies.erase(enemies.begin() + i);
      }
    }

    // Tower attacks.
    canFire.assign(towers.size(), 0);
    for (int i = 0; i < static_cast<int>(towers.size()); i += 1) {
      towers[i].cooldown = std::max(0.0f, towers[i].cooldown - input.dt);
      canFire[i] = towers[i].cooldown <= 0.0f ? 1 : 0;
    }

    if (!enemies.empty() && !towers.empty()) {
      const bool ok = gpu.run(towers, canFire, enemies, targetIndex, enemyDirectDamage);
      if (!ok) {
        std::cerr << "GPU wave kernel execution failed\n";
        out.defeat = 1;
        break;
      }

      for (int i = 0; i < static_cast<int>(enemies.size()); i += 1) {
        enemies[i].hp -= enemyDirectDamage[i];
      }

      for (int ti = 0; ti < static_cast<int>(towers.size()); ti += 1) {
        if (!canFire[ti]) {
          continue;
        }
        const int target = targetIndex[ti];
        if (target < 0 || target >= static_cast<int>(enemies.size())) {
          continue;
        }

        Tower& t = towers[ti];
        t.cooldown = t.attackSpeed > 0.0f ? 1.0f / t.attackSpeed : 0.0f;

        if (t.type == 2) {
          Enemy& e = enemies[target];
          if (t.burnDps > 0.0f) {
            e.burnDps = std::max(e.burnDps, t.burnDps);
            e.burnDuration = std::max(e.burnDuration, t.burnDuration);
          }
          fireZones.push_back({e.x, e.y, t.fireballRadius, t.fireballDps, t.fireballDuration});
          continue;
        }

        if (t.type == 3) {
          std::vector<int> targets = topTargetsInRange(enemies, t.x, t.y, t.range, std::max(1, t.windTargets));
          for (int idx : targets) {
            enemies[idx].hp -= t.damage;
            enemies[idx].slowPercent = std::max(enemies[idx].slowPercent, t.slowPercent);
            enemies[idx].slowDuration = std::max(enemies[idx].slowDuration, t.slowDuration);
          }
          continue;
        }

        if (t.type == 1) {
          const float tx = enemies[target].x;
          const float ty = enemies[target].y;
          const float splashDamage = t.damage * (1.0f - t.splashFalloff / 100.0f);
          if (t.splashRadius > 0.0f && splashDamage > 0.0f) {
            for (int ei = 0; ei < static_cast<int>(enemies.size()); ei += 1) {
              if (ei == target) {
                continue;
              }
              const float dx = (enemies[ei].x - tx) * WORLD_SCALE;
              const float dy = (enemies[ei].y - ty) * WORLD_SCALE;
              const float d = std::sqrt(dx * dx + dy * dy);
              if (d <= t.splashRadius) {
                enemies[ei].hp -= splashDamage;
              }
            }
          }
          continue;
        }

        if (t.type == 4 && t.chainCount > 0) {
          const float sx = enemies[target].x;
          const float sy = enemies[target].y;

          struct ChainCandidate {
            int idx;
            float d;
          };
          std::vector<ChainCandidate> candidates;
          candidates.reserve(enemies.size());
          for (int ei = 0; ei < static_cast<int>(enemies.size()); ei += 1) {
            if (ei == target) {
              continue;
            }
            const float dx = (sx - enemies[ei].x) * WORLD_SCALE;
            const float dy = (sy - enemies[ei].y) * WORLD_SCALE;
            candidates.push_back({ei, std::sqrt(dx * dx + dy * dy)});
          }
          std::sort(candidates.begin(), candidates.end(), [](const ChainCandidate& a, const ChainCandidate& b) {
            return a.d < b.d;
          });

          int hits = 0;
          const float chainDamage = t.damage * (1.0f - t.chainFalloff / 100.0f);
          for (const ChainCandidate& c : candidates) {
            if (hits >= t.chainCount) {
              break;
            }
            if (c.d > CHAIN_RADIUS) {
              continue;
            }
            enemies[c.idx].hp -= chainDamage;
            enemies[c.idx].shockDuration = std::max(enemies[c.idx].shockDuration, t.shockDuration);
            hits += 1;
          }
        }
      }
    }

    // Remove dead from attacks.
    for (int i = static_cast<int>(enemies.size()) - 1; i >= 0; i -= 1) {
      if (enemies[i].hp <= 0.0f) {
        out.coins += enemies[i].coin;
        out.xp += enemies[i].xp;
        out.killed += 1;
        enemies.erase(enemies.begin() + i);
      }
    }

    // Movement + leaks.
    for (int i = static_cast<int>(enemies.size()) - 1; i >= 0; i -= 1) {
      const float slowMultiplier = 1.0f - std::min(enemies[i].slowPercent / 100.0f, 0.84f);
      enemies[i].distance += enemies[i].speed * slowMultiplier * input.dt;
      if (enemies[i].distance >= enemies[i].routeLength) {
        out.coins -= input.leakCoins;
        out.xp = std::max(0.0f, out.xp - input.leakXp);
        out.leaked += 1;
        enemies.erase(enemies.begin() + i);
      }
    }

    if (out.coins < 0.0f) {
      out.defeat = 1;
      break;
    }

    if (queueIndex >= static_cast<int>(input.queue.size()) && enemies.empty()) {
      break;
    }

    guard += 1;
  }

  out.towerCooldowns.reserve(towers.size());
  for (const Tower& t : towers) {
    out.towerCooldowns.push_back({t.slotIndex, t.cooldown});
  }
  out.fireZones = fireZones;

  return out;
}

void writeWaveOutput(const WaveOutput& out) {
  std::cout
    << "OK "
    << out.coins << ' '
    << out.xp << ' '
    << out.leaked << ' '
    << out.killed << ' '
    << out.towerCooldowns.size() << ' '
    << out.fireZones.size() << ' '
    << out.defeat;

  for (const auto& [slotIndex, cooldown] : out.towerCooldowns) {
    std::cout << ' ' << slotIndex << ' ' << cooldown;
  }

  for (const FireZone& zone : out.fireZones) {
    std::cout
      << ' ' << zone.x
      << ' ' << zone.y
      << ' ' << zone.radius
      << ' ' << zone.dps
      << ' ' << zone.duration;
  }

  std::cout << '\n';
}

}  // namespace

int main() {
  while (true) {
    WaveInput input;
    if (!parseWaveInput(input)) {
      if (std::cin.eof()) {
        return 0;
      }
      return 1;
    }
    WaveOutput out = simulateWave(input);
    writeWaveOutput(out);
    std::cout.flush();
  }
  return 0;
}
