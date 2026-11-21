# 설비 로그 분석기 (log-analyzer)

설비 로그 파일 하나를 브라우저에서 열어, 알람을 발생 단위로 묶고 **경고→알람 리드 타임**과 **근거 줄이 붙은 원인 후보**를 보여주는 웹 앱(PWA)입니다. 서버가 없고, 파일은 브라우저 밖으로 나가지 않습니다.

**바로 열기: https://mhbae-semi-lab.github.io/log-analyzer/** (설치 없음, 예시 로그가 열려 있음)

[English summary](#english)

## 1. 관점

장비 SW 엔지니어가 설비 Down 뒤 수만 줄 로그에서 "무엇이 먼저 깨졌나"를 찾는 시간을 줄입니다. 범용 로그 도구는 데이터를 줄과 숫자로 보지만, 이 앱은 **설비 · 모듈 · 알람 코드 · 알람 연쇄 · 경고**를 기본 개념으로 다룹니다.

## 2. 해결

- 알람(ERROR 이상)을 시간 간격으로 **발생**으로 묶고, 첫 알람 코드가 같은 발생끼리 **군집**으로 모읍니다 (`L103 → A201 → S305` 같은 연쇄도 함께).
- 첫 알람 앞 구간에 반복된 경고를 **발생 앞 비율 · 집중도 · 리드 타임(중앙값 · 범위)** 으로 찾습니다.
- 원인 후보마다 **근거 줄 번호**를 붙이고, 누르면 로그 뷰어 · 타임라인이 그 줄로 갑니다.
- 과거 Down 발생을 **사례**로 저장하면, 조기 경보 규칙이 "몇 분 먼저 잡았나"를 사례마다 다시 계산합니다.
- 설정을 바꾸기 전에 같은 데이터로 **전후 비교**하고, LLM 결과는 **Shadow** 칸에서 먼저 지켜본 뒤 기준을 넘으면 **전환**, 언제든 **롤백**합니다.

## 3. 상용 비교 · 차별점 (조사 2026-11-21)

| 제품 | 형태 | 이 앱과 관련된 기능 |
|---|---|---|
| Splunk (Enterprise / Cloud, ITSI) | 서버 · SaaS | `cluster` · `transaction maxpause` 로 묶기 가능 (SPL 작성), ITSI 는 KPI 로 30분 앞 서비스 상태 예측 |
| Datadog Logs | SaaS | Log Patterns, Watchdog 로그 이상 탐지, Bits AI 원인 가설, Cloud SIEM Historical Jobs (탐지 규칙을 과거 로그에 돌려보기) |
| Elastic Observability | 서버 · SaaS | 로그 범주화 · 패턴 분석 · 로그 비율 분석, AI Assistant |
| lnav | 오픈소스 터미널 | 히스토그램 · SQL · 타임라인 뷰, 군집 · 원인 분석 없음 |
| klogg | 오픈소스 데스크톱 | 수 GB 파일 빠른 열기 · 정규식 검색 |
| Log Voyager 등 | 브라우저 전용 뷰어 | 업로드 없이 큰 파일 보기, 알람 군집 · 통계 없음 |
| INFICON FabGuard | 팹 FDC | 센서 트레이스 기반 이상 탐지 (텍스트 로그 파일용 아님) |

출처: [Splunk cluster](https://docs.splunk.com/Documentation/Splunk/latest/Search/Detectingpatterns) · [Splunk transaction](https://help.splunk.com/en/splunk-enterprise/search/search-manual/10.4/group-and-correlate-events/identify-and-group-events-into-transactions) · [Splunk ITSI Predictive Analytics](https://docs.splunk.com/Documentation/ITSI/4.13.3/SI/PA) · [Datadog Watchdog Insights](https://docs.datadoghq.com/logs/explorer/watchdog_insights/) · [Datadog Bits AI SRE](https://docs.datadoghq.com/bits_ai/bits_ai_sre/investigate_issues/) · [Datadog Historical Jobs](https://docs.datadoghq.com/security/cloud_siem/detect_and_monitor/custom_detection_rules/create_rule/historical_job/) · [Elastic AIOps](https://www.elastic.co/observability-labs/blog/observability-logs-machine-learning-aiops) · [lnav](https://lnav.org/features) · [klogg](https://github.com/variar/klogg) · [Log Voyager](https://korben.info/en/log-voyager-analyze-massive-log-files-browser.html) · [INFICON FabGuard](https://www.inficon.com/en/products/intelligent-manufacturing-systems/fabguard)

**이 앱이 다른 점** (조사한 제품 중에서 찾지 못함, 2026-11 기준)

1. **경고→알람 리드 타임을 기본 결과로** 냅니다. 라벨한 Down 사례마다 조기 경보 규칙이 몇 분 먼저 잡았는지(또는 놓쳤는지)와 현재 로그의 오경보 수를 함께 계산합니다. 규칙을 과거 로그에 돌려보는 기능 자체는 Datadog Historical Jobs 에도 있습니다.
2. 수집 파이프라인 · 에이전트 · 클러스터 없이 **브라우저에서 파일 하나로 알람 군집과 직전 경고 통계까지** 냅니다. 브라우저 전용 뷰어는 있지만 이 분석은 찾지 못했습니다.
3. LLM 원인 후보를 **인용 줄 번호 · 수치로 검증**하고, 실패하면 이유를 알려 1회 다시 묻고, 그래도 실패하면 규칙 결과로 대체합니다. LLM 은 사용자 본인 키(Anthropic) 또는 이 PC 의 Ollama 를 씁니다.

## 4. 설치 · 사용

- 웹 주소(https://mhbae-semi-lab.github.io/log-analyzer/)에서 바로 열거나, 브라우저의 "앱 설치"로 PWA 를 설치합니다. 한 번 열면 오프라인에서도 열립니다 (LLM 제외).
- 로컬 실행 (빌드 없음):
  ```
  python -m http.server 8731 --bind 127.0.0.1
  ```
  → `http://127.0.0.1:8731/`
- 사용 순서: 예시 로그(합성)가 처음부터 열려 있습니다 → 군집을 누르면 직전 경고 · 리드 타임 · 원인 후보 → 내 로그는 끌어다 놓기 → 과거 Down 은 "사례로 저장" → "현장 검증" 4단계.
- 읽는 형식: ISO(`2026-11-10 09:12:40.000 ALARM [LOADER] L103 ...`), syslog RFC 3164 · 5424, CSV · TSV(열 지정, 날짜+시각 열 합치기), JSON Lines(키 지정 · 중첩 키), 사용자 정규식(이름 그룹). 인코딩 UTF-8 · EUC-KR · UTF-16 자동 감지. 읽지 못한 줄은 줄 번호와 사유를 보여줍니다.
- 저장: 이 브라우저의 IndexedDB (사례 · 규칙 · 설정 이력 · Shadow 기록 · 마지막 파일 200MB 미만). 설정에서 JSON 백업 · 가져오기 · 전체 삭제.
- 내보내기: HTML 보고서(단일 파일) · CSV(발생 단위) · JSON(분석 전체).
- 사용자 매뉴얼: [docs/manual/Log-Analyzer-User-Manual-ko.pdf](docs/manual/Log-Analyzer-User-Manual-ko.pdf)

### 개발

```
node --test                      # 단위 · 회귀 테스트 (의존성 없음, Node 20+)
node tools/bench.mjs 100          # 100MB 합성 로그 파싱 · 분석 시간
node tools/llm-fallback.mjs qwen2.5:3b   # 로컬 Ollama 모델의 검증 실패 → 규칙 대체율 (30회)
node docs/manual/capture.mjs     # 매뉴얼 화면 캡처 (로컬 서버 실행 중, Chrome 필요)
python docs/manual/build_manual.py   # 매뉴얼 PPTX 생성 (python-pptx, Pillow)
```

- 정적 파일(바닐라 JS, ES 모듈)만 있고 빌드 단계가 없습니다. 외부 CDN 을 쓰지 않습니다.
- `vendor/anthropic-sdk/anthropic-sdk.js` 는 `@anthropic-ai/sdk@1.6.0` 을 esbuild 로 묶은 파일입니다:
  `npx esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2022 --minify --legal-comments=eof --outfile=anthropic-sdk.js`
  (`entry.mjs` = `export { default } from '@anthropic-ai/sdk'; export * from '@anthropic-ai/sdk';`)
- `vendor/pretendard/` 는 `pretendard@1.3.9` 의 `dist/web/static/woff2-subset` 중 쓰는 굵기 4종입니다.

## 5. 측정값

| 항목 | 결과 |
|---|---|
| 100MB (163만 줄) 파싱 + 분석, Node 24 | 3.9초 (`node tools/bench.mjs 100`) |
| 100MB, 브라우저 (Chrome, Worker) 파일 놓기 → 화면 | 6.7 ~ 7.0초 |
| 500MB (816만 줄), 브라우저 | Worker 파싱 27.2초, JS 힙 약 1.8GB |
| 합성 Down 사례 3종 리드 타임 (기본 규칙) | 진공 저하 4.3분 · 모터 과열 3.0분 · 램프 열화 1.5분 |
| 검증기: 정상 출력에 결함 5종 주입 | 25건 중 25건 검출 |
| 실제 모델 대체율: Ollama qwen2.5:3b, 군집 5 × 직전 구간 3 × 한/영 = 30회 | 규칙 대체 2회 (6.7%), 첫 시도 통과 22회, 재시도 통과 6회, 규칙 1순위와 일치 82%, 중앙값 6.8초 ([결과](docs/measurements/llm-fallback-qwen2.5-3b.json)) |
| 같은 측정, Ollama 호출 보강 전 | 대체 9회 (30%): 영어에서 빈 후보 목록, 한국어에서 끝나지 않는 출력 → 스키마로 후보 1~3개 강제 · 출력 1,500토큰 상한 · 문맥 8K 로 고침 ([결과](docs/measurements/llm-fallback-qwen2.5-3b-before.json)) |

## 6. 한계

- 원인 후보는 통계와 근거 줄로 고른 **후보**입니다. 확정은 현장 확인이 필요합니다.
- 알람은 레벨(ERROR · ALARM · FATAL)로 판단합니다. 레벨이 없는 로그는 사용자 정규식으로 level 을 지정해야 합니다.
- 브라우저 메모리 안에서 처리하므로 약 500MB 이상은 기기 메모리에 따라 어렵습니다.
- syslog RFC 3164 는 연도가 없어 읽기 설정의 연도를 씁니다.
- 모의 응답(오프라인 시연)은 실제 모델이 아니며, 검증 · 재시도 · 대체 흐름을 보여주려고 정해진 결함을 넣습니다.
- Ollama: 이 PC 에서 localhost 로 연 페이지는 기본 설정으로 연결됩니다. 웹 주소(예: github.io)에서 부르려면 `OLLAMA_ORIGINS` 에 그 주소를 넣어야 하고, 브라우저의 로컬 네트워크 접근 허용이 필요할 수 있습니다 (웹 주소 경로는 아직 확인하지 않음).
- 검증은 근거 줄 · 수치가 실제로 있는지를 확인할 뿐, 원인 추론이 맞는지는 보장하지 않습니다 (예: 소형 모델이 집중도 7% 경고를 2순위 원인으로 고르는 경우).

## 7. 만든 방법

배민혁이 설계하고, 구현 · 테스트 · 문서 작성에 AI 코딩 도구(Claude Code)를 썼습니다. 예시 로그와 사례는 모두 합성 데이터이며 실제 장비 · 알람 코드와 관련이 없습니다.

라이선스: MIT. 포함한 서드파티: Pretendard (SIL OFL 1.1), Anthropic TypeScript SDK (Apache-2.0).

---

## English

**Equipment Log Analyzer** opens an equipment log file in the browser, groups alarms into occurrences and clusters, and shows the **warning-to-alarm lead time** and **cause candidates with evidence lines**. No server; your file never leaves the browser.

- Formats: ISO, syslog RFC 3164/5424, CSV/TSV with column mapping, JSON Lines, custom regex; UTF-8 / EUC-KR / UTF-16 detection; unreadable lines listed with line number and reason.
- Field validation flow: reproduce (saved down cases + three synthetic cases), compare (A/B settings on the same data, changed cells highlighted), shadow (LLM results shown alongside while rules decide), switch and rollback (versioned settings).
- LLM is optional: your own Anthropic API key (kept in memory by default) or a local Ollama model. Every LLM answer is checked against the cited line numbers and numbers in the evidence; on failure it retries once, then falls back to rule-based causes. Before sending you see the exact prompt with masking applied.
- Not found among the products surveyed (Nov 2026): lead time per labeled down case as a default result; alarm clusters and prior-warning statistics from a single file in the browser; evidence-checked LLM causes with rule fallback.
- Live demo: https://mhbae-semi-lab.github.io/log-analyzer/
- Run locally: `python -m http.server 8731 --bind 127.0.0.1`, tests: `node --test`.
- Built by 배민혁 with an AI coding assistant (Claude Code). All sample data is synthetic. MIT License.
