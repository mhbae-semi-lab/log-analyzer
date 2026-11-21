// 예시 로그(gen.js seed 20261110)에 대해 미리 써 둔 원인 후보 (한/영). LLM 호출 결과가 아니다.
// 근거는 줄 번호 대신 문구 패턴으로 들고 있다가, 화면에서 근거 줄 목록에서 찾아 번호로 바꾼다 (resolvePatterns).
const C = (cause, causeEn, confidence, reasoning, reasoningEn, patterns) => ({ cause, causeEn, confidence, reasoning, reasoningEn, patterns });

const RAW = {
  L103: {
    causes: [
      C("로더 진공 압력이 서서히 떨어져 흡착이 풀림 — 진공 라인 누설 또는 흡착 패드 마모 의심",
        "Loader vacuum pressure drops gradually until the wafer is released — suspect a vacuum line leak or worn suction pad", "high",
        "3번 모두 알람 몇 분 전부터 진공 압력 저하 경고가 반복되고, 압력이 기준 -65.0 kPa 보다 약해짐",
        "In all 3 occurrences, vacuum-low warnings repeat minutes before the alarm and pressure is weaker than the -65.0 kPa limit", ["Vacuum pressure low"]),
      C("흡착이 풀린 웨이퍼가 밀려 정렬 위치 이탈(A201)과 존재 감지 불일치(S305)가 연쇄 발생",
        "The released wafer shifts, causing the position-out-of-range (A201) and presence-mismatch (S305) chain", "medium",
        "L103 뒤 수 초 안에 매번 같은 순서로 따라오므로 별도 원인이 아닌 2차 알람으로 보임",
        "They follow L103 within seconds in the same order every time, so they look secondary rather than separate causes", ["A201", "S305"]),
      C("진공 센서 자체의 오검출 가능성 — 하트비트 진공값 추세와 대조 필요",
        "The vacuum sensor itself may misread — compare with the heartbeat vacuum trend", "low",
        "경고 직전 하트비트 진공값도 함께 약해지는지 확인하면 센서 문제와 실제 누설을 구분할 수 있음",
        "Checking whether heartbeat vacuum values also weaken before the warnings separates a sensor fault from a real leak", ["Status vacuum"]),
    ],
    checks: ["진공 라인 · 피팅 누설 점검", "흡착 패드 마모 · 이물 확인", "진공 센서 영점 확인"],
    checksEn: ["Check vacuum lines and fittings for leaks", "Inspect the suction pad for wear or debris", "Verify the vacuum sensor zero point"],
  },
  C402: {
    causes: [
      C("오후부터 조명 램프 광량이 계속 떨어져(열화) 영상 밝기가 하한 아래로 내려감",
        "Lamp output keeps falling from the afternoon (wear) until image brightness drops below the limit", "high",
        "램프 광량 저하 경고가 4번의 발생 앞에 모두 있음. 경고가 하루 내내 퍼져 있어 집중도는 낮지만 추세가 원인을 가리킴",
        "Lamp-drift warnings precede all 4 occurrences. They are spread across the day so concentration is low, but the trend points to the cause", ["Lamp intensity drift"]),
      C("노출 자동 보정(gain 상승)으로 버티다 보정 범위를 넘어선 시점에 알람 발생",
        "Auto exposure (rising gain) compensates until it runs out of range, then the alarm fires", "medium",
        "알람 직전마다 노출 자동 보정 경고가 나타남 — 원인이라기보다 광량 부족을 메우려던 흔적",
        "Auto-exposure warnings appear right before each alarm — a trace of compensating for low light rather than the cause", ["Exposure auto-adjusted"]),
      C("정렬 점수 저하(A202)는 어두운 영상 때문에 생긴 2차 알람",
        "The low align score (A202) is a secondary alarm caused by the dark image", "medium",
        "C402 직후 매번 A202 가 따라옴", "A202 follows C402 every time", ["A202"]),
    ],
    checks: ["램프 사용 시간 · 교체 주기 확인", "기준 광량 재측정 후 광량 보정", "노출 보정 상한 설정값 확인"],
    checksEn: ["Check lamp hours and replacement cycle", "Re-measure reference intensity and recalibrate", "Check the auto-exposure upper limit setting"],
  },
  S301: {
    causes: [
      C("X축 모터 온도가 경고 기준을 넘은 뒤 추종 오차가 커짐 — 모터 과열 의심",
        "Following error grows after the X-axis motor temperature exceeds the warning limit — suspect motor overheating", "high",
        "2번 모두 알람 몇 분 전부터 모터 온도 경고(기준 65.0C)가 반복됨",
        "In both occurrences, motor temperature warnings (limit 65.0C) repeat minutes before the alarm", ["Motor temp high"]),
      C("추종 오차 직후의 서보 오프(S302)는 보호 동작으로 보임",
        "The servo-off (S302) right after the following error looks like a protective action", "medium",
        "S301 뒤 1초 안팎에 매번 S302 가 따라옴", "S302 follows S301 within about 1 second every time", ["S302"]),
      C("냉각 부족이나 구동부 부하 증가로 온도가 오름 — 하트비트 온도 추세 확인 필요",
        "Temperature rises from poor cooling or higher drive load — check the heartbeat temperature trend", "low",
        "평소 모터 온도와 알람 직전 온도를 비교하면 서서히 오른 것인지 급히 오른 것인지 구분 가능",
        "Comparing normal and pre-alarm motor temperature tells a slow rise from a sudden one", ["Status motorX temp"]),
    ],
    checks: ["X축 모터 냉각 팬 · 방열 상태 확인", "구동부 윤활 · 이물에 의한 부하 확인", "온도 경고 시 감속 동작 설정 검토"],
    checksEn: ["Check the X-axis motor cooling fan and heat sink", "Check drive lubrication and debris load", "Review slow-down behavior on temperature warnings"],
  },
  C401: {
    causes: [
      C("직전 경고 없이 단발로 나타나고 재시도로 바로 회복 — 일시적인 프레임 수신 지연",
        "Appears alone without prior warnings and recovers on retry — a transient frame delay", "medium",
        "6번 모두 바로 다음 줄에서 재시도 성공 · 자동 해제되고 후속 알람이 없음",
        "In all 6 occurrences the next lines show a successful retry and auto-clear, with no follow-up alarm", ["Frame retry ok"]),
      C("카메라 케이블 · 그래버 간헐 접촉 가능성 — 빈도 추적 필요",
        "Possible intermittent camera cable or grabber contact — track the frequency", "low",
        "발생 간격이 일정하지 않고 앞 구간의 공통 경고도 없어 하루치 로그로는 판단이 어려움",
        "Intervals are irregular and there is no common prior warning, so one day of log is not enough to judge", ["C401"]),
    ],
    checks: ["카메라 케이블 체결 상태 확인", "발생 빈도를 며칠 단위로 추적"],
    checksEn: ["Check camera cable connections", "Track occurrence frequency over several days"],
  },
  L104: {
    causes: [
      C("작업자 로그인 직후의 도어 개방 — 장비 이상이 아닌 작업자 조작",
        "Door opened right after an operator login — operator action, not an equipment fault", "high",
        "2번 모두 작업자 로그인 뒤 도어가 열리고, 닫힌 뒤 작업자가 알람을 해제함",
        "In both occurrences the door opens after an operator login and the operator resets the alarm after closing it", ["Operator login", "Door closed"]),
    ],
    checks: ["도어 개방 사유를 작업 일지와 대조"],
    checksEn: ["Compare the door-open reason with the work log"],
  },
};

// lang 에 맞춘 원인 후보 (패턴은 그대로)
export function sampleCauses(code, lang = "ko") {
  const s = RAW[code];
  if (!s) return null;
  const en = lang === "en";
  return {
    causes: s.causes.map((c) => ({ cause: en ? c.causeEn : c.cause, reasoning: en ? c.reasoningEn : c.reasoning, confidence: c.confidence, patterns: c.patterns })),
    checks: en ? s.checksEn : s.checks,
  };
}
export const SAMPLE_CODES = Object.keys(RAW);
