# kiro-team (kt) — Phase 0: Project Bootstrap

## Goal
프로젝트 초기화. 빌드 가능한 TypeScript 프로젝트 + CLI skeleton.

## Preconditions
- Node.js >= 20
- tmux >= 3.0
- kiro-cli 설치됨

## Steps

### 0.1 프로젝트 구조 생성
- `~/projects/kiro-team/` 디렉토리
- `package.json` — name: "kiro-team", bin: {"kt": "./bin/kt.js"}
- `tsconfig.json` — target: ES2022, module: NodeNext, outDir: dist/
- `biome.json` — formatter + linter
- `.gitignore` — node_modules, dist/

### 0.2 CLI Entrypoint
- `bin/kt.js` — #!/usr/bin/env node, imports dist/cli/index.js
- `src/cli/index.ts` — commander.js 기반 command router
  - `kt team <N> "<task>"` — 메인 진입점 (stub)
  - `kt status [team-name]` — 상태 조회 (stub)
  - `kt shutdown <team-name>` — 종료 (stub)
  - `kt api <operation> --input '{}' --json` — worker interop (stub)
  - `kt hud --watch` — HUD (stub)
  - `kt scale-up <team> <N>` — worker 추가 (stub)
  - `kt scale-down <team> <worker>` — worker 제거 (stub)
  - `kt resume <team-name>` — 재개 (stub)

### 0.3 기본 유틸리티
- `src/utils/paths.ts`
  - `ktStateDir()` → `~/.kt/`
  - `ktTeamDir(teamName)` → `~/.kt/teams/<name>/`
  - `ktWorkerDir(teamName, workerName)` → `~/.kt/teams/<name>/workers/<worker>/`
  - `ktLogsDir()` → `~/.kt/logs/`
- `src/utils/safe-json.ts` — atomic JSON read/write (write to .tmp then rename)
- `src/utils/sleep.ts` — async sleep + sync sleep
- `src/utils/platform-command.ts` — cross-platform spawn wrapper

### 0.4 설치 전략 (PATH 문제 해결)
kt가 worker의 kiro-cli 세션에서 호출 가능해야 함.
- 개발: `npm link` → `kt` 가 global PATH에 등록
- 배포: `npm i -g kiro-team` → 동일
- `kt doctor` 명령 추가 — kt, tmux, kiro-cli 설치 상태 확인

### 0.5 빌드 + 실행 검증
- `npm run build` → dist/ 생성
- `node bin/kt.js --help` → 명령어 목록 출력
- `node bin/kt.js team --help` → team 서브커맨드 help 출력
- `node bin/kt.js doctor` → 환경 검증 결과 출력

## Deliverables
- [ ] `npm run build` 성공 (exit code 0)
- [ ] `kt --help` 출력에 team, status, shutdown, api, hud, scale-up, scale-down, resume, doctor 명령어 표시
- [ ] `kt doctor` 가 tmux, kiro-cli, kt 자체의 PATH 등록 상태를 확인

## Acceptance Criteria
- 빌드 에러 0개
- 모든 stub 명령어가 "Not implemented yet" 메시지 출력
- `src/utils/` 함수들이 올바른 경로 반환
- `kt doctor` 가 tmux 버전, kiro-cli 버전, kt 경로를 출력
