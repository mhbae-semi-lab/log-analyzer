# -*- coding: utf-8 -*-
"""설비 로그 분석기 사용자 매뉴얼(PPTX) 생성기. llm-pulse docs/manual/build_manual.py 양식을 이 앱에 맞게 고쳐 쓴다.

    python docs/manual/build_manual.py

스크린샷은 docs/manual/capture.mjs 로 만든 shots/*.png (1280x800 CSS px, 배율 1.5) 와
말풍선 자리 shots/marks.json (CSS px 사각형) 을 쓴다. 화면은 모두 합성 데이터다.
"""
import json
import os
import sys

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
ASSETS = os.path.join(HERE, "assets")
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "Log-Analyzer-User-Manual-ko.pptx")
VERSION = "1.0.0"
DATE = "2026.11.21"
NAME = "설비 로그 분석기"
MARKS = json.load(open(os.path.join(SHOTS, "marks.json"), encoding="utf-8"))
DIP = (1280, 800)

# ---------------------------------------------------------------- 디자인 토큰 (llm-pulse 매뉴얼과 같음, 강조색만 앱 색)
INK = RGBColor(0x1F, 0x29, 0x37)
SUB = RGBColor(0x5B, 0x65, 0x73)
BLUE = RGBColor(0xC0, 0x00, 0x00)
NAVY = RGBColor(0x14, 0x14, 0x18)
CARD = RGBColor(0xF3, 0xF5, 0xF8)
LINE = RGBColor(0xD9, 0xDE, 0xE5)
AMBER = RGBColor(0xE5, 0xA0, 0x2D)
AMBER_BG = RGBColor(0xFF, 0xF6, 0xE5)
AMBER_TX = RGBColor(0x7A, 0x4E, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFT = RGBColor(0xF2, 0xB8, 0xB8)
FONT = "맑은 고딕"
MONO = "Consolas"

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
TOTAL = 23
state = {"n": 0}


def new_slide():
    state["n"] += 1
    return prs.slides.add_slide(prs.slide_layouts[6])


def box(s, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE, radius=None, lw=0.75):
    sh = s.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    sh.shadow.inherit = False
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        sh.adjustments[0] = radius
    return sh


def rbox(s, x, y, w, h, fill=CARD, line=None, radius=0.03, lw=0.75):
    return box(s, x, y, w, h, fill, line, MSO_SHAPE.ROUNDED_RECTANGLE, radius, lw)


def text(s, x, y, w, h, t, size=12, bold=False, color=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         shape=None, font=FONT, spacing=None):
    tb = shape or s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = anchor
    lines = t if isinstance(t, list) else [t]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing:
            p.line_spacing = spacing
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = font
    return tb


def num_circle(s, x, y, n, d=0.3, size=11):
    c = box(s, x, y, d, d, fill=BLUE, line=WHITE, shape=MSO_SHAPE.OVAL, lw=1.5)
    text(s, 0, 0, 0, 0, str(n), size, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
    c.text_frame.margin_left = c.text_frame.margin_right = 0
    return c


# ---------------------------------------------------------------- 공통 틀
def header(s, section, title, bullets):
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, section, 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, f"[로그 분석기] {title}", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    for i, t in enumerate(bullets):
        box(s, 0.55, 1.37 + i * 0.36, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
        text(s, 0.72, 1.24 + i * 0.36, 12.1, 0.32, t, 13.5)
    footer(s)


def footer(s):
    box(s, 0.5, 7.05, 12.33, 0.01, fill=LINE)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.5), Inches(7.12), Inches(0.22), Inches(0.22))
    text(s, 0.78, 7.1, 6, 0.25, f"{NAME} 사용자 매뉴얼  ·  v{VERSION}  ·  배민혁", 9, False, SUB)
    text(s, 11.8, 7.1, 1.03, 0.25, f"{state['n']} / {TOTAL}", 9, True, SUB, PP_ALIGN.RIGHT)


# ---------------------------------------------------------------- 스크린샷 카드
def load_shot(name, crop=None, dip=DIP):
    """crop: CSS px 사각형 (x0,y0,x1,y1). 반환: (경로, 크기, 오프셋)"""
    path = os.path.join(SHOTS, f"{name}.png")
    im = Image.open(path)
    k = im.width / dip[0]
    if not crop:
        return path, dip, (0, 0)
    os.makedirs(CACHE, exist_ok=True)
    x0, y0, x1, y1 = crop
    out = os.path.join(CACHE, f"{name}_{x0}_{y0}_{x1}_{y1}.png")
    im.crop((round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))).save(out, optimize=True)
    return out, (x1 - x0, y1 - y0), (x0, y0)


def M(name, *idx):
    """marks.json 에서 말풍선 자리 고르기 (숫자 대신 사각형을 직접 줄 수도 있음)"""
    out = []
    for i in idx:
        r = MARKS[name][i] if isinstance(i, int) else i
        if r:
            out.append(tuple(r))
    return out


def shot_card(s, x, y, w, h, title, name, callouts=(), crop=None, dip=DIP, d=0.24):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    path, (dw, dh), (ox, oy) = load_shot(name, crop, dip)
    bw, bh = w - 0.4, h - 0.82  # 아래 0.2in 는 "합성 데이터" 표기 자리
    k = min(bw / dw, bh / dh)
    iw, ih = dw * k, dh * k
    ix, iy = x + (w - iw) / 2, y + 0.5
    box(s, ix - 0.02, iy - 0.02, iw + 0.04, ih + 0.04, fill=WHITE, line=LINE)
    s.shapes.add_picture(path, Inches(ix), Inches(iy), Inches(iw), Inches(ih))
    for n, r in enumerate(callouts, 1):
        x0, y0, x1, y1 = r
        x0, y0, x1, y1 = max(x0, ox), max(y0, oy), min(x1, ox + dw), min(y1, oy + dh)
        box(s, ix + (x0 - ox) * k, iy + (y0 - oy) * k, max(0.05, (x1 - x0) * k), max(0.05, (y1 - y0) * k), fill=None, line=BLUE,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08, lw=1.75)
        c = box(s, ix + (x0 - ox) * k - d / 2, iy + (y0 - oy) * k - d / 2, d, d, fill=BLUE, line=WHITE,
                shape=MSO_SHAPE.OVAL, lw=1.25)
        text(s, 0, 0, 0, 0, str(n), 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
        c.text_frame.margin_left = c.text_frame.margin_right = 0
    text(s, x + w - 3.0, y + h - 0.27, 2.85, 0.22, "※ 합성 데이터로 찍은 화면", 8.5, False, SUB, PP_ALIGN.RIGHT)


def steps_card(s, x, y, w, h, steps, title="사용 순서", tip=None, desc_size=10):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    n = len(steps)
    top = y + 0.52
    avail = h - 0.52 - (0.62 if tip else 0.15)
    pitch = min(0.8, avail / n)
    for i, (hd, ds) in enumerate(steps):
        yy = top + i * pitch
        num_circle(s, x + 0.2, yy + 0.03, i + 1)
        text(s, x + 0.62, yy - 0.02, w - 0.8, 0.28, hd, 12, True)
        text(s, x + 0.62, yy + 0.24, w - 0.8, pitch - 0.22, ds, desc_size, False, SUB)
    if tip:
        t = rbox(s, x + 0.15, y + h - 0.55, w - 0.3, 0.42, fill=AMBER_BG, line=AMBER, radius=0.15)
        text(s, 0, 0, 0, 0, "Tip  " + tip, 9.5, False, AMBER_TX, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, shape=t)
        t.text_frame.margin_left = Inches(0.12)


CY, CH = 2.45, 4.5      # 카드 영역
LX, LW = 0.5, 7.0       # 왼쪽(스크린샷) 카드
RX, RW = 7.65, 5.18     # 오른쪽(순서) 카드


def shot_steps(section, title, bullets, shot, callouts, steps, tip=None, card_title=None, crop=None, desc_size=10):
    s = new_slide()
    header(s, section, title, bullets)
    shot_card(s, LX, CY, LW, CH, card_title or title, shot, callouts, crop)
    steps_card(s, RX, CY, RW, CH, steps, tip=tip, desc_size=desc_size)
    return s


def bars(s, x0, y0, w, h, dark=True):
    """표지용 타임라인 그림: 정보 밀도 위에 경고(주황) · 알람(빨강) 막대"""
    import random
    rnd = random.Random(20261110)
    lanes = 5
    lh = h / lanes
    for i in range(lanes):
        box(s, x0, y0 + i * lh, w, lh - 0.04, fill=RGBColor(0x22, 0x22, 0x28) if dark else CARD)
        for _ in range(26):
            xx = x0 + rnd.random() * w
            box(s, xx, y0 + i * lh + lh * 0.55, 0.02, lh * 0.35, fill=RGBColor(0x55, 0x55, 0x5E))
    for xx, lane, kind in [(0.18, 0, "w"), (0.21, 0, "w"), (0.24, 0, "w"), (0.27, 0, "a"), (0.28, 2, "a"), (0.29, 1, "a"),
                           (0.52, 1, "w"), (0.55, 1, "w"), (0.58, 1, "a"), (0.59, 1, "a"), (0.75, 3, "w"), (0.78, 3, "a"), (0.79, 2, "a")]:
        col = BLUE if kind == "a" else AMBER
        box(s, x0 + xx * w, y0 + lane * lh + 0.05, 0.05 if kind == "a" else 0.035, lh - 0.14, fill=col)


# ================================================================ 1. 표지
def cover():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    bars(s, 0.0, 5.35, 13.333, 1.9)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.8), Inches(0.9), Inches(0.9), Inches(0.9))
    text(s, 0.75, 2.0, 7, 1.0, NAME, 46, True, WHITE)
    text(s, 0.8, 3.0, 7, 0.6, "사용자 매뉴얼", 26, False, SOFT)
    box(s, 0.85, 3.75, 0.9, 0.06, fill=BLUE)
    text(s, 0.8, 3.95, 6.0, 0.9, ["설비 Down 뒤 '무엇이 먼저 깨졌나'를", "브라우저에서 파일 하나로 찾는 웹 앱"], 15, False, RGBColor(0xC9, 0xD3, 0xE0))
    text(s, 0.8, 4.85, 7, 0.3, f"Version {VERSION}   ·   {DATE}   ·   배민혁", 11, False, RGBColor(0x8A, 0x97, 0xA8))
    path, _, _ = load_shot("Home")
    box(s, 6.88, 0.78, 6.0, 3.77, fill=None, line=RGBColor(0x3A, 0x3A, 0x44), lw=1.5)
    s.shapes.add_picture(path, Inches(6.9), Inches(0.8), Inches(5.96), Inches(3.725))


# ================================================================ 2. 목차
def toc():
    s = new_slide()
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, "목차", 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, "목차", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    text(s, 0.55, 1.2, 12, 0.35, "처음 쓰는 분은 1~2번, 필요한 화면만 찾는 분은 오른쪽 쪽수를 보세요.", 13.5, False, SUB)
    groups = [
        ("1", "시작하기", [("3", "이 앱이 푸는 문제"), ("4", "설치와 첫 실행"), ("5", "화면 구성")]),
        ("2", "화면별 사용법", [("6", "타임라인"), ("7", "알람 군집 · 발생"), ("8", "직전 경고 · 리드 타임"), ("9", "원인 후보 · Shadow 칸"), ("10", "로그 뷰어")]),
        ("3", "현장 검증 절차", [("11", "4단계 한눈에"), ("12", "재현"), ("13–14", "비교"), ("15", "Shadow"), ("16", "전환 · 롤백")]),
        ("4", "내 데이터 · LLM", [("17", "읽을 수 있는 형식"), ("18", "읽지 못한 줄 · 오류 메시지"), ("19", "LLM 설정"), ("20", "보낼 내용 미리보기 · 마스킹")]),
        ("5", "부록", [("21", "영어 · 다크 · 모바일 · 키보드"), ("22", "FAQ · 문제 해결"), ("23", "버전 정보")]),
    ]
    pos = [(0.5, 1.9, 3.95, 2.45), (4.69, 1.9, 3.95, 2.45), (8.88, 1.9, 3.95, 2.45),
           (0.5, 4.5, 6.05, 2.4), (6.78, 4.5, 6.05, 2.4)]
    for (no, name, items), (x, y, w, h) in zip(groups, pos):
        rbox(s, x, y, w, h)
        num_circle(s, x + 0.2, y + 0.2, no, 0.38, 13)
        text(s, x + 0.7, y + 0.2, w - 0.9, 0.4, name, 16, True, anchor=MSO_ANCHOR.MIDDLE)
        for i, (pg, nm) in enumerate(items):
            yy = y + 0.74 + i * 0.32
            text(s, x + 0.3, yy, 0.9, 0.3, pg, 11.5, True, BLUE)
            text(s, x + 1.2, yy, w - 1.4, 0.3, nm, 11.5, False, INK)
    footer(s)


# ================================================================ 3. 소개
def intro():
    s = new_slide()
    header(s, "시작하기", "이 앱이 푸는 문제", [
        "관점: 장비 SW 엔지니어가 설비 Down 뒤 수만 줄 로그에서 '무엇이 먼저 깨졌나'를 찾는 시간을 줄인다",
        "로그를 줄 · 숫자가 아니라 설비 · 모듈 · 알람 코드 · 알람 연쇄 · 경고로 읽는다",
        "서버 · 에이전트 없이 브라우저에서 파일 하나로 동작하고, 파일은 이 기기 밖으로 나가지 않는다",
    ])
    cards = [
        ("발생 · 군집", "알람 사이 간격으로 발생을 묶고, 첫 알람 코드가 같은 발생끼리 군집으로 모읍니다. L103 → A201 → S305 같은 연쇄도 함께 봅니다."),
        ("리드 타임", "첫 알람 앞 구간에 반복된 경고를 발생 앞 비율 · 집중도와 함께 찾고, 경고가 알람보다 몇 분 먼저 나왔는지 보여줍니다."),
        ("근거 줄 · 검증", "원인 후보마다 근거 줄 번호를 붙입니다. LLM 결과는 인용 줄과 수치를 검증하고, 실패하면 규칙 결과로 대체합니다."),
    ]
    for i, (hd, ds) in enumerate(cards):
        x = 0.5 + i * 4.19
        rbox(s, x, 2.45, 3.95, 1.95)
        num_circle(s, x + 0.2, 2.65, i + 1, 0.36)
        text(s, x + 0.68, 2.64, 3.1, 0.38, hd, 15, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.25, 3.18, 3.5, 1.1, ds, 11, False, SUB)
    text(s, 0.5, 4.62, 6, 0.3, "로그가 판단이 되기까지", 13, True)
    flow = [
        ("로그 읽기", ["ISO · syslog · CSV", "JSON Lines · 정규식"]),
        ("발생 · 군집", ["알람 간격으로 묶기", "첫 알람 코드로 모으기"]),
        ("직전 경고", ["발생 앞 · 집중도", "리드 타임"]),
        ("현장 검증", ["재현 → 비교", "Shadow → 전환 · 롤백"]),
    ]
    w, gap = 2.78, 0.4
    for i, (hd, ln) in enumerate(flow):
        x = 0.5 + i * (w + gap)
        hl = i == 2
        rbox(s, x, 5.0, w, 1.75, fill=WHITE if hl else CARD, line=BLUE if hl else None, radius=0.04, lw=2)
        text(s, x + 0.1, 5.1, w - 0.2, 0.4, hd, 14, True, BLUE if hl else INK, PP_ALIGN.CENTER)
        text(s, x + 0.1, 5.6, w - 0.2, 1.0, ln, 10.5, False, SUB, PP_ALIGN.CENTER)
        if i < 3:
            box(s, x + w + 0.06, 5.72, gap - 0.12, 0.34, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


# ================================================================ 4. 설치
def install():
    s = new_slide()
    header(s, "시작하기", "설치와 첫 실행", [
        "웹 주소를 열면 바로 쓸 수 있고, 브라우저의 '앱 설치'로 PWA 로 설치하면 오프라인에서도 열림",
        "처음 열면 안내 창과 합성 예시 로그가 함께 열려, 내 파일 없이도 모든 기능을 둘러볼 수 있음",
        "서버가 없으므로 계정 · 로그인이 없음. 데이터는 이 브라우저(IndexedDB)에만 저장",
    ])
    steps_card(s, 0.5, CY, 6.0, CH, [
        ("주소 열기", "Chrome · Edge · Firefox 최신판에서 앱 주소를 엽니다."),
        ("앱 설치 (선택)", "주소창 오른쪽 '앱 설치' 아이콘 → 설치. 시작 메뉴 · 바탕 화면에서 창으로 열립니다."),
        ("첫 실행 안내", "예시 로그 · 내 로그 · 사례 저장 3가지를 안내합니다. [시작하기]로 닫습니다."),
        ("내 PC 에서 직접 실행", "저장소 폴더에서  python -m http.server 8731 --bind 127.0.0.1  → http://127.0.0.1:8731/"),
    ], title="설치 순서", tip="새 버전이 나오면 화면 아래에 '새로고침' 안내가 뜹니다", desc_size=10.5)
    shot_card(s, 6.75, CY, 6.08, CH, "첫 실행 안내", "Onboard", crop=(300, 160, 980, 640))


# ================================================================ 본문
def screens():
    H = MARKS["Home"]
    shot_steps("시작하기", "화면 구성", [
        "오른쪽 위: 언어(한국어 · English) · 테마(자동 · 밝게 · 어둡게) · 도움말 · 설정",
        "위에서 아래로: 불러오기 → 타임라인 → 알람 군집 · 상세 → 현장 검증 절차 → 로그 뷰어",
        "단축키  /  메시지 검색,  ?  도움말",
    ], "Home", M("Home", 4, 5, 6, 7, 8), [
        ("예시 로그 (합성)", "가상 검사기 SpotCheck 의 하루. 처음부터 열려 있습니다"),
        ("내 로그 열기", "파일을 고르거나 페이지에 끌어다 놓습니다"),
        ("읽기 설정", "형식 · 인코딩 · 시간대 · CSV 열 · JSON 키 · 정규식"),
        ("요약", "줄 · 정보 · 경고 · 알람 → 발생 → 군집 수, 형식과 읽은 시간"),
        ("내보내기", "HTML 보고서 · CSV(발생 단위) · JSON(분석 전체)"),
    ], tip="새로고침해도 마지막 파일(200MB 미만)과 선택한 군집이 다시 열립니다", card_title="첫 화면")

    SEC = "화면별 사용법"
    shot_steps(SEC, "타임라인", [
        "모듈마다 한 줄(레인). 회색은 정보 밀도, 주황은 경고, 빨강은 알람, 연한 빨강은 선택한 군집의 발생",
        "드래그로 확대, 더블클릭으로 전체. 알람을 누르면 그 군집과 줄로 이동",
        "레인 순서는 설비 사전(비교 탭)의 모듈 순서를 따름",
    ], "Timeline", M("Timeline", 0, 1, 2, 3, 4), [
        ("타임라인", "마우스를 올리면 가까운 경고 · 알람 줄이 보입니다"),
        ("범례", "정보 밀도 · 경고 · 알람 · 선택한 군집의 발생"),
        ("표로 보기", "같은 내용을 발생 표(시작 · 끝 · 코드 · 알람 수 · 연쇄)로 봅니다"),
        ("보이는 구간", "확대하면 '(확대됨)'이 붙습니다"),
        ("전체 보기", "확대를 풀고 하루 전체로 돌아갑니다"),
    ], tip="키보드: 타임라인에 초점을 두고 ← → 이동, + − 확대 · 축소, 0 전체", card_title="타임라인")

    shot_steps(SEC, "알람 군집 · 발생", [
        "알람(ERROR · ALARM · FATAL) 사이가 '발생 묶기 간격'(기본 120초)보다 짧으면 한 발생",
        "첫 알람 코드가 같은 발생끼리 군집. 후속 알람이 붙는 연쇄 군집이 위로 정렬",
        "과거 Down 발생은 '사례로 저장'해 재현 세트로 씀",
    ], "Clusters", M("Clusters", 0, 1, 2, 3, 4, 5), [
        ("코드 · 그룹 · 횟수", "알람 코드, 설비 사전의 알람 그룹, 발생 횟수"),
        ("알람 연쇄", "가장 많이 나온 연쇄 (예: L103 → A201 → S305)"),
        ("리드 타임 요약", "1순위 직전 경고가 알람보다 몇 분 먼저인지 (중앙값)"),
        ("결정된 1순위 원인", "확신도와 함께 한 줄로"),
        ("발생 목록", "누르면 그 발생의 첫 알람 줄로 이동"),
        ("사례로 저장", "선택한 발생 앞 60분 ~ 뒤 10분을 사례로 저장"),
    ], card_title="알람 군집 · 상세", desc_size=9.5)

    shot_steps(SEC, "직전 경고 · 리드 타임", [
        "첫 알람 앞 구간(기본 10분)에 나온 경고를 종류(숫자는 #)별로 셈",
        "발생 앞 = 몇 번의 발생 앞에 나왔나, 집중도 = 그 경고 전체 중 알람 직전에 몰린 비율",
        "리드 타임 = 구간 안 첫 경고에서 첫 알람까지 (중앙값, 최소~최대)",
    ], "Precursors", M("Precursors", 0, 1, 2, 3, 4), [
        ("직전 구간", "2 · 5 · 10 · 30 · 60분. 바꾸면 변경 이력에 남습니다"),
        ("발생 앞", "예: 3/3 = 세 번 모두 그 경고가 먼저 나옴"),
        ("집중도", "하루 내내 나오는 잡음 경고는 낮게 나옵니다"),
        ("리드 타임", "경고가 알람보다 몇 분 먼저 나왔나"),
        ("+ 규칙", "이 경고로 조기 경보 규칙 초안을 만듭니다 (비교 탭)"),
    ], tip="발생 앞이 높고 집중도도 높은 경고가 원인에 가까운 신호입니다", card_title="직전 경고 표")

    shot_steps(SEC, "원인 후보 · Shadow 칸", [
        "왼쪽 '결정' 칸: 규칙(통계) 또는 미리 써 둔 예시. LLM 이 없어도 항상 채워짐",
        "오른쪽 'Shadow' 칸: LLM 결과는 여기에만 보이고 결정을 바꾸지 않음",
        "근거 줄 번호를 누르면 로그 뷰어와 타임라인이 그 줄로 이동",
    ], "Causes", M("Causes", 0, 1, 2, 3, 4, 5), [
        ("LLM 으로 분석", "보낼 내용 미리보기를 연 뒤 보냅니다"),
        ("규칙 기반", "통계 규칙 결과로 바꿉니다 (예시가 있는 군집은 '예시로 되돌리기')"),
        ("결정 칸 출처", "미리 써 둔 예시 · 규칙 기반 · LLM 분석 · 규칙 대체"),
        ("근거 줄", "보낸 근거 목록 안의 줄 번호만 허용"),
        ("검증 결과", "검증 통과 · 실패, 규칙 1순위와 같은 근거인지"),
        ("호출 기록", "시도별 결과. 실패하면 이유를 알려 한 번 더 묻습니다"),
    ], card_title="원인 후보", desc_size=9.5)

    shot_steps(SEC, "로그 뷰어", [
        "타임라인에서 보이는 구간의 줄을 보여주고, 레벨 · 모듈 · 검색으로 거름",
        "경고는 주황 바탕, 알람은 빨강 바탕, 근거 줄은 굵게 + 왼쪽 빨간 선",
        "키보드: 목록에 초점을 두고 ↑ ↓ PgUp PgDn",
    ], "Viewer", M("Viewer", 0, 1, 2, 3), [
        ("레벨", "모든 레벨 · 경고 이상 · 알람만"),
        ("모듈", "한 모듈만 보기"),
        ("메시지 검색", "모듈 · 메시지에서 찾기 (단축키 /)"),
        ("현재 줄", "근거 줄 · 발생 · 타임라인에서 고른 줄"),
    ], tip="줄이 많으면 현재 줄 주변 400줄만 그립니다 (위에 '몇 줄 중 몇 줄 표시')", card_title="로그 뷰어")


def flow_overview():
    s = new_slide()
    header(s, "현장 검증 절차", "4단계 한눈에", [
        "바꾸기 전에 같은 데이터로 확인하고, 새 방법은 옆에서 먼저 돌려 보고, 언제든 되돌린다",
        "화면 '현장 검증 절차' 패널의 탭 4개가 이 순서를 그대로 따름 (← → 로 탭 이동)",
        "오른쪽 위 배지는 지금 결정 방식: '규칙이 결정 (기본)' 또는 'LLM (전환됨)'",
    ])
    st = [
        ("재현", "과거 Down 사례 세트를 연다", ["합성 사례 3종 기본 포함", "내 발생을 '사례로 저장'", "규칙별 리드 타임 백테스트"]),
        ("비교", "같은 데이터로 A / B 를 나란히", ["간격 · 직전 구간 · 규칙 · 사전", "바뀐 칸만 빨갛게", "B 적용 = 새 버전"]),
        ("Shadow", "새 방법은 옆 칸에서만", ["LLM 결과는 참고만", "검증 · 일치를 매번 기록", "다른 경우만 모아 보기"]),
        ("전환 · 롤백", "기준을 넘으면 전환", ["5회 · 검증 90% · 일치 80%", "검증 실패 시 규칙으로 대체", "모든 버전 한 번에 되돌리기"]),
    ]
    w, gap = 2.85, 0.31
    for i, (hd, sub, items) in enumerate(st):
        x = 0.5 + i * (w + gap)
        rbox(s, x, 2.6, w, 3.9, fill=WHITE, line=BLUE if i == 0 else LINE, radius=0.04, lw=1.5)
        num_circle(s, x + 0.2, 2.8, i + 1, 0.42, 14)
        text(s, x + 0.75, 2.8, w - 0.9, 0.42, hd, 17, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.2, 3.4, w - 0.4, 0.6, sub, 11.5, True, SUB)
        for j, it in enumerate(items):
            box(s, x + 0.25, 4.22 + j * 0.55, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
            text(s, x + 0.4, 4.08 + j * 0.55, w - 0.55, 0.5, it, 11)
        if i < 3:
            box(s, x + w + 0.03, 4.3, gap - 0.06, 0.3, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


def verify():
    SEC = "현장 검증 절차"
    shot_steps(SEC, "① 재현", [
        "재현 세트 = 과거 Down 사례 모음. 각 사례는 Down 시각 앞 60분 ~ 뒤 10분의 로그를 함께 저장",
        "지금 적용 중인 조기 경보 규칙으로 사례마다 '몇 분 먼저 잡았나'를 다시 계산",
        "현재 로그에서 규칙이 울렸지만 알람이 오지 않은 경보는 오경보로 셈",
    ], "Repro", M("Repro", 0, 1, 2, 3, 4), [
        ("재현 탭", "현장 검증 절차의 첫 단계"),
        ("사례 목록", "합성 예시 3종 + 내가 저장한 사례"),
        ("열기", "사례의 발췌 로그를 열어 그때 상황을 다시 봅니다"),
        ("요약", "잡은 사례 수 · 리드 타임 중앙값 · 현재 로그 오경보"),
        ("사례별 백테스트", "첫 경고 · 규칙 경보 시각 · 리드 타임 · 잡음 / 놓침"),
    ], tip="리드 타임 = Down 시각 − 규칙이 처음 울린 시각", card_title="재현 세트와 백테스트")

    shot_steps(SEC, "② 비교 — 초안 만들기", [
        "A = 지금 적용 중인 설정, B = 초안. B 만 고칠 수 있음",
        "조기 경보 규칙: [모듈] 경고가 '안에(분)' 동안 '횟수' 이상 → 경보, '예고 범위(분)' 안에 대상 알람이 오면 적중",
        "설비 사전(JSON)으로 알람 코드 패턴 · 모듈 순서 · 알람 그룹을 내 설비에 맞춤",
    ], "CompareEdit", M("CompareEdit", 0, 1, 2, 3, 4, 5), [
        ("A · 지금 적용", "읽기 전용"),
        ("발생 묶기 간격", "B 의 간격(초) · 직전 구간(분)"),
        ("규칙 값", "횟수 · 안에(분) · 예고 범위(분)을 고칩니다"),
        ("규칙 제안", "현재 로그의 군집별 1순위 직전 경고로 규칙을 만듭니다"),
        ("설비 사전", "codePattern · modules · groups"),
        ("비교 실행", "같은 데이터로 A 와 B 를 계산합니다"),
    ], card_title="비교: 초안 B", desc_size=9.5)

    shot_steps(SEC, "② 비교 — 결과 보기", [
        "요약 카드: 발생 · 군집 · 잡은 사례 · 리드 타임 중앙값 · 오경보를 A → B 로",
        "바뀐 칸만 빨갛게 강조. '바뀐 행만'으로 바뀐 군집만 볼 수 있음",
        "예: 카메라 경고 규칙 횟수 2 → 3 이면 오경보 4 → 1, 대신 램프 열화 사례를 놓침",
    ], "CompareResult", M("CompareResult", 0, 1, 2, 3), [
        ("요약 A → B", "바뀐 항목은 빨간 테두리"),
        ("바뀐 칸", "사례별 리드 타임 · 군집별 발생 · 1순위 경고 · 원인"),
        ("바뀐 행만", "변화가 있는 군집만 남깁니다"),
        ("B 적용", "새 버전으로 저장되고, 전환 · 롤백 탭에서 되돌릴 수 있습니다"),
    ], tip="적용하기 전에는 아무것도 바뀌지 않습니다", card_title="비교 결과")

    shot_steps(SEC, "③ Shadow", [
        "군집에서 'LLM 으로 분석'을 실행할 때마다 검증 통과 · 규칙과 일치 여부가 기록됨",
        "일치 = LLM 1순위 근거 줄이 규칙 1순위 근거와 같은 종류(모듈 + 문구 틀)의 줄을 가리킴",
        "전환 기준: 지금 고른 제공자 기준 5회 이상 · 검증 통과 90% 이상 · 일치 80% 이상",
    ], "ShadowPass", M("ShadowPass", 0, 1, 2), [
        ("기준 진행", "초록 테두리 = 통과, 빨강 = 아직"),
        ("다른 경우만", "검증 실패 · 불일치 기록만 모아 봅니다"),
        ("Shadow 기록", "시각 · 군집 · 모델 · 검증 · 일치 · 규칙 1순위 · LLM 1순위"),
    ], tip="'모의 응답'은 실제 모델이 아니라 흐름을 보여주는 시연용입니다", card_title="Shadow 기록")

    shot_steps(SEC, "④ 전환 · 롤백", [
        "Shadow 기준을 넘으면 'LLM 결정으로 전환' 버튼이 켜짐",
        "전환 뒤에도 LLM 결과가 검증에 실패하면 그 군집은 규칙 결과로 대체",
        "모든 설정 변경(비교 적용 · 직전 구간 · 결정 방식)은 버전으로 남고 한 번에 되돌림",
    ], "Switch", M("Switch", 0, 1, 2, 3), [
        ("결정 방식 배지", "지금 누가 결정하는지"),
        ("규칙 결정으로 되돌리기", "한 번에 롤백"),
        ("변경 이력", "버전 · 시각 · 바뀐 것 · 간격 · 구간 · 규칙 수 · 방식"),
        ("이 버전으로 되돌리기", "그 버전의 설정으로 돌아가고, 되돌림도 새 버전으로 남습니다"),
    ], card_title="전환 · 롤백")


def data():
    SEC = "내 데이터 · LLM"
    shot_steps(SEC, "읽을 수 있는 형식", [
        "ISO: 2026-11-10 09:12:40.000 ALARM [LOADER] L103 ... ([모듈]은 레벨 앞뒤 모두 가능)",
        "syslog RFC 3164 · 5424, CSV · TSV, JSON Lines, 사용자 정규식(이름 그룹)",
        "인코딩 UTF-8 · EUC-KR · UTF-16 자동 감지. 공백으로 시작하는 줄은 앞 줄에 이어진 줄로 셈",
    ], "ReadOpts", M("ReadOpts", 0, 1, 2, 4, 5), [
        ("형식", "자동 감지 또는 직접 선택"),
        ("인코딩", "자동 (UTF-8 → EUC-KR), 고정 선택 가능"),
        ("표시 시간대", "Z · +09:00 이 붙은 시각만 바꿉니다"),
        ("CSV 열 지정", "머리글 이름 또는 번호. 날짜 · 시각이 다른 열이면 1+2"),
        ("다시 읽기", "같은 파일을 바뀐 설정으로 다시 읽습니다"),
    ], tip="레벨 낱말이 다르면 사용자 정규식의 level 그룹으로 지정하세요", card_title="읽기 설정")

    s = shot_steps(SEC, "읽지 못한 줄 · 오류 메시지", [
        "읽지 못한 줄은 버리지 않고 개수와 사유, 줄 번호, 앞부분을 보여줌 (처음 50줄)",
        "읽은 줄만으로 분석은 계속됨. 형식이 다르면 읽기 설정을 바꾸고 '다시 읽기'",
        "예시는 일부 줄이 깨진 합성 CSV (열 부족 · 날짜 형식 · 레벨 오류)",
    ], "BadLines", M("BadLines", 0, 1, 2), [
        ("요약", "읽은 줄 수와 읽지 못한 줄 수"),
        ("사유 요약", "펼치면 줄 번호 · 사유 · 내용 표"),
        ("줄별 사유", "열 개수 부족 · 시각을 찾지 못함 · 레벨 낱말 없음 · JSON 아님 · 정규식 불일치"),
    ], card_title="읽지 못한 줄", desc_size=10)

    shot_steps(SEC, "LLM 설정", [
        "LLM 은 선택 사항. 없어도 군집 · 리드 타임 · 원인 후보 · 현장 검증이 모두 규칙으로 동작",
        "제공자: Anthropic Claude(본인 API 키) · Ollama(이 PC 의 로컬 모델) · 모의 응답(시연)",
        "API 키는 기본적으로 메모리에만. '이 브라우저에 키 저장'을 켤 때만 IndexedDB 에 저장",
    ], "Settings", M("Settings", 0, 1, 2, 3, 4, 5), [
        ("제공자", "Anthropic · Ollama · 모의 응답"),
        ("API 키", "요청은 브라우저에서 api.anthropic.com 으로 바로 갑니다"),
        ("키 저장", "공용 PC 에서는 끄세요"),
        ("모델", "Claude Opus 5.5 (기본) · Sonnet 5.5 · Haiku 5.5"),
        ("시간 제한", "기본 90초. 넘으면 그 시도는 실패로 기록"),
        ("마스킹", "IP · MAC · 메일 · 경로 · id= · lot= · host= · serial= + 추가 정규식"),
    ], tip="Ollama: localhost 로 연 페이지는 그대로 연결, 웹 주소에서는 OLLAMA_ORIGINS 에 그 주소 추가", card_title="설정", desc_size=9.5)

    shot_steps(SEC, "보낼 내용 미리보기 · 마스킹", [
        "'LLM 으로 분석'을 누르면 보낼 프롬프트 전문을 먼저 보여주고, [보내기]를 눌러야 전송",
        "보내는 것: 군집 통계 + 근거 줄 최대 80줄. 로그 파일 전체는 보내지 않음",
        "마스킹된 값은 [ID-1] 처럼 바뀌고 노란색으로 표시. 같은 값은 같은 표지",
    ], "Preview", M("Preview", 0, 1, 2), [
        ("요약", "제공자 · 모델 · 근거 줄 수 · 글자 수 · 마스킹 수 · 시간 제한"),
        ("마스킹 표시", "가려진 자리"),
        ("보내기", "분석 중에는 [취소]로 멈출 수 있습니다"),
    ], card_title="보낼 내용 미리보기")


def appendix():
    s = new_slide()
    header(s, "부록", "영어 · 다크 · 모바일 · 키보드", [
        "오른쪽 위에서 한국어 · English 를 바꾸면 화면 문구와 규칙 원인 문장 · 검증 메시지가 함께 바뀜",
        "테마 버튼: 자동(기기 설정) → 밝게 → 어둡게. 휴대폰 폭에서도 같은 기능",
        "타임라인 그림은 '표로 보기'로 같은 내용을 표로 볼 수 있음 (화면 낭독기용)",
    ])
    path, _, _ = load_shot("EnDetail")
    rbox(s, 0.5, CY, 6.6, CH)
    text(s, 0.65, CY + 0.1, 6, 0.32, "English", 13, True)
    s.shapes.add_picture(path, Inches(0.7), Inches(CY + 0.5), Inches(6.2), Inches(3.875))
    p2, _, _ = load_shot("MobileDark", dip=(390, 844))
    rbox(s, 7.3, CY, 2.3, CH)
    text(s, 7.45, CY + 0.1, 2.0, 0.32, "모바일 · 다크", 13, True)
    s.shapes.add_picture(p2, Inches(7.55), Inches(CY + 0.5), Inches(1.8), Inches(1.8 * 1266 / 585))
    rbox(s, 9.8, CY, 3.03, CH)
    text(s, 9.95, CY + 0.1, 2.8, 0.32, "단축키", 13, True)
    keys = [("/", "메시지 검색"), ("?", "도움말"), ("← →", "타임라인 이동 · 탭 이동"), ("+ −  0", "확대 · 축소 · 전체"), ("↑ ↓", "로그 줄 이동"), ("PgUp PgDn", "20줄씩"), ("Esc", "대화상자 닫기")]
    for i, (k, d) in enumerate(keys):
        yy = CY + 0.6 + i * 0.52
        chip = rbox(s, 9.95, yy, 1.15, 0.36, fill=INK, radius=0.2)
        text(s, 0, 0, 0, 0, k, 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=chip, font=MONO)
        text(s, 11.2, yy, 1.6, 0.36, d, 10.5, False, INK, anchor=MSO_ANCHOR.MIDDLE)


def faq():
    s = new_slide()
    header(s, "부록", "FAQ · 문제 해결", [
        "대부분은 '읽기 설정'과 '설비 사전'으로 해결. 도움말(?) 창에도 같은 내용이 있음",
        "예기치 않은 오류는 도움말 → 오류 기록에 이 기기에만 남음 (외부로 보내지 않음)",
        "데이터 백업 · 가져오기 · 전체 삭제는 설정 → 데이터",
    ])
    qa = [
        ("알람이 하나도 안 나와요", "ERROR · ALARM · FATAL 레벨 줄이 있어야 합니다. 레벨 낱말이 다르면 사용자 정규식으로 level 그룹을 지정하세요."),
        ("코드가 아니라 문장으로 묶여요", "비교 탭의 설비 사전에서 codePattern 을 내 알람 코드 형식에 맞게 바꾸고 B 를 적용하세요."),
        ("시각이 몇 시간 밀려요", "로그에 Z 나 +00:00 이 붙어 있으면 '표시 시간대'를 장비 현지 시간대로 고르세요."),
        ("한글이 깨져요", "읽기 설정의 인코딩을 EUC-KR 로 고정하고 '다시 읽기'를 누르세요."),
        ("큰 파일이 느려요", "100MB 는 7초 안팎, 500MB 는 30초 안팎입니다. 그 이상은 기간을 나눠 여세요."),
        ("Ollama 연결이 안 돼요", "localhost 로 연 페이지는 기본 설정으로 됩니다. 웹 주소에서 열었다면 OLLAMA_ORIGINS 에 그 주소를 넣고 다시 시작하세요."),
        ("LLM 결과가 결정에 안 쓰여요", "기본은 규칙이 결정합니다. Shadow 기준을 넘긴 뒤 전환 탭에서 전환하세요."),
        ("오프라인에서도 되나요?", "한 번 열면 앱 파일이 저장되어 오프라인으로 열립니다 (LLM 은 Ollama 제외 네트워크 필요)."),
    ]
    cw, ch = 6.05, 1.02
    for i, (q, a) in enumerate(qa):
        col, row = i % 2, i // 2
        x = 0.5 + col * (cw + 0.23)
        y = CY + row * (ch + 0.13)
        rbox(s, x, y, cw, ch)
        text(s, x + 0.15, y + 0.08, 0.4, 0.32, "Q", 13, True, BLUE)
        text(s, x + 0.5, y + 0.08, cw - 0.65, 0.32, q, 12, True)
        text(s, x + 0.5, y + 0.42, cw - 0.65, 0.56, a, 10, False, SUB)


def back():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    bars(s, 0.0, 2.2, 13.333, 1.7)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(6.2), Inches(0.9), Inches(0.9), Inches(0.9))
    text(s, 0, 4.4, 13.333, 0.6, NAME, 30, True, WHITE, PP_ALIGN.CENTER)
    text(s, 0, 5.05, 13.333, 0.4, "알람 군집 · 경고→알람 리드 타임 · 근거 줄이 붙은 원인 후보", 13, False, RGBColor(0xC9, 0xD3, 0xE0), PP_ALIGN.CENTER)
    text(s, 0, 5.7, 13.333, 0.6, [f"v{VERSION}   ·   만든 사람 배민혁   ·   MIT License   ·   © 2026",
                                  "포함: Pretendard (SIL OFL 1.1) · Anthropic TypeScript SDK 1.6.0 (Apache-2.0) · 예시 로그와 화면은 모두 합성 데이터"],
         10, False, RGBColor(0x8A, 0x97, 0xA8), PP_ALIGN.CENTER)


def main():
    cover()            # 1
    toc()              # 2
    intro()            # 3
    install()          # 4
    screens()          # 5–10
    flow_overview()    # 11
    verify()           # 12–16
    data()             # 17–20
    appendix()         # 21
    faq()              # 22
    back()             # 23
    assert state["n"] == TOTAL, state["n"]
    prs.save(OUT)
    print("saved", OUT)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
