#!/usr/bin/env python3
"""1분에디터 — 관리자 운영가이드 / 고객 사용방법(스탠다드·프리미엄) PDF 생성.

다시 만들 때: python3 scripts/generate_guides_pdf.py
필요: macOS AppleGothic, pip install reportlab
"""

from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    "/Library/Fonts/AppleGothic.ttf",
    "/System/Library/Fonts/AppleGothic.ttf",
]

SKY = HexColor("#0284c7")
DARK = HexColor("#082f49")
MUTED = HexColor("#475569")
LINE = HexColor("#bae6fd")
BG = HexColor("#f0f9ff")
WARN = HexColor("#b45309")

BASE = "https://acrosseditor.onrender.com"
CUSTOMER_URL = f"{BASE}/"
OPS_URL = f"{BASE}/ops/"
PRIVACY_URL = f"{BASE}/privacy"
WRITTEN = "2026-10-06"
CONTACT = "카톡/문자 070-8065-1258 · acrosstool@gmail.com"
BANK = "하나은행 365-910996-44807 (예금주: 신일)"


def register_font() -> str:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            pdfmetrics.registerFont(TTFont("KR", path))
            return "KR"
    raise FileNotFoundError("한글 폰트(AppleGothic)를 찾을 수 없습니다.")


def styles(font: str):
    base = getSampleStyleSheet()
    return {
        "cover": ParagraphStyle(
            "cover",
            parent=base["Title"],
            fontName=font,
            fontSize=22,
            leading=30,
            textColor=DARK,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "sub": ParagraphStyle(
            "sub",
            parent=base["Normal"],
            fontName=font,
            fontSize=11,
            leading=16,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=16,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName=font,
            fontSize=14,
            leading=20,
            textColor=DARK,
            spaceBefore=14,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName=font,
            fontSize=12,
            leading=17,
            textColor=HexColor("#0369a1"),
            spaceBefore=10,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName=font,
            fontSize=10,
            leading=15,
            textColor=DARK,
            alignment=TA_LEFT,
            spaceAfter=6,
        ),
        "code": ParagraphStyle(
            "code",
            parent=base["Normal"],
            fontName=font,
            fontSize=8.5,
            leading=13,
            textColor=DARK,
            backColor=BG,
            leftIndent=4,
            rightIndent=4,
            spaceBefore=4,
            spaceAfter=8,
        ),
        "warn": ParagraphStyle(
            "warn",
            parent=base["Normal"],
            fontName=font,
            fontSize=10,
            leading=15,
            textColor=WARN,
            spaceAfter=8,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontName=font,
            fontSize=9,
            leading=13,
            textColor=DARK,
        ),
        "cellh": ParagraphStyle(
            "cellh",
            parent=base["Normal"],
            fontName=font,
            fontSize=9,
            leading=13,
            textColor=white,
        ),
    }


def bullets(items, font, s):
    lis = [ListItem(Paragraph(t, s["body"]), leftIndent=12, bulletColor=SKY) for t in items]
    return ListFlowable(
        lis,
        bulletType="bullet",
        start="•",
        leftIndent=18,
        bulletFontName=font,
        bulletFontSize=10,
    )


def table(headers, rows, col_widths, s):
    data = [[Paragraph(h, s["cellh"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), s["cell"]) for c in row])
    styled = Table(data, colWidths=col_widths, repeatRows=1)
    styled.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), SKY),
                ("TEXTCOLOR", (0, 0), (-1, 0), white),
                ("BACKGROUND", (0, 1), (-1, -1), white),
                ("FONTNAME", (0, 0), (-1, -1), s["body"].fontName),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return styled


def page_chrome(brand):
    def add_header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(SKY)
        canvas.rect(0, A4[1] - 8 * mm, A4[0], 8 * mm, fill=1, stroke=0)
        canvas.setFillColor(MUTED)
        canvas.setFont("KR", 8)
        canvas.drawString(18 * mm, 12 * mm, brand)
        canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, f"{doc.page}")
        canvas.restoreState()

    return add_header_footer


def payment_rows(plan_rows):
    return plan_rows + [
        ["입금 계좌", BANK],
        ["입금 후 연락", CONTACT],
        ["키 받는 시간", "확인 후 약 10분 이내"],
    ]


def shared_start(story, s):
    story.append(Paragraph("1. 쓰는 곳", s["h1"]))
    story.append(
        Paragraph(
            "문구는 <b>크롬 확장 1분에디터</b>에서 만듭니다. "
            "도구막대 아이콘을 누르면 옆 패널이 열립니다. "
            "회원가입은 없고, 관리자에게 받은 라이선스 키만 있으면 됩니다. "
            "고객 Gemini 키는 필요 없습니다.",
            s["body"],
        )
    )
    story.append(Paragraph(f"고객 웹(구독·키 확인): <b>{CUSTOMER_URL}</b>", s["body"]))


def shared_notes(limit_line):
    return [
        limit_line,
        "매월 한도는 다시 채워지고, 쓰지 않은 건은 다음 달로 넘어가지 않습니다.",
        "기간은 키를 처음 등록한 날부터 30일입니다.",
        "캡처와 미리보기 수정은 건수에 포함되지 않습니다. 문구 만들기를 누를 때 1건이 빠집니다.",
        "한 화면은 최대 9칸입니다.",
        "키를 다른 사람에게 공유하지 마세요. 한도가 같이 깎입니다.",
        f"개인정보 처리방침: {PRIVACY_URL}",
        f"문의: {CONTACT}",
    ]


def usage_steps(plan_name):
    return [
        "크롬에서 참고할 홈페이지 탭을 엽니다.",
        "도구막대의 1분에디터 아이콘을 눌러 옆 패널을 엽니다.",
        f"연결 설정에 서버 주소 {BASE} 와 받은 라이선스 키를 넣고 설정 저장을 누릅니다.",
        f"상단에 {plan_name}과 오늘·이번 달 남은 건이 보이면 등록된 것입니다.",
        "캡처할 주소를 확인한 뒤 전체 페이지 캡처를 누릅니다.",
        "구간 선택에서 문구로 바꿀 구간을 고릅니다. 모두 선택을 쓸 수 있습니다.",
        "새 홈페이지 방향, 상호, 말투를 적고 문구 만들기를 누릅니다.",
        "구간별 문구에서 칸마다 복사를 눌러 아임웹 글자 칸에 붙여 넣습니다.",
        "고치고 싶으면 수정으로 문구를 바꾼 뒤 다시 복사합니다. 이 수정은 건수에 포함되지 않습니다.",
    ]


def trouble_table(s, extra_rows):
    rows = [
        ["등록이 안 됨", "키 철자(하이픈 포함)와 서버 주소 https://acrosseditor.onrender.com 을 확인합니다. 키를 받기 전이면 관리자에게 문의합니다."],
        ["첫 요청만 매우 느림", "서버가 잠에서 깨는 시간입니다. 1분 기다렸다가 다시 누릅니다."],
        ["오늘/이번 달 한도 초과", "다음 날 또는 다음 주기에 다시 이용하거나, 추가 1건(1,000원)·플랜 변경을 문의합니다."],
        ["문구가 실패함", "같은 화면에서 한 번 더 시도합니다. 계속 실패하면 관리자에게 문의합니다. 실패 건은 확인 후 1건을 되돌릴 수 있습니다."],
    ] + extra_rows
    return table(["상황", "이렇게 해 보세요"], rows, [50 * mm, 125 * mm], s)


def build_admin(s, font):
    story = []
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("1분에디터", s["sub"]))
    story.append(Paragraph("관리자 설정 · 운영 가이드", s["cover"]))
    story.append(Paragraph(f"입금 확인 후 라이선스 키 발급 · 연장 · 고객 안내<br/>작성일: {WRITTEN}", s["sub"]))
    story.append(
        Paragraph(
            "키는 운영 콘솔에서 발급합니다. 로컬 테스트 서버에서 만든 키는 고객이 쓰는 Render 서버에 생기지 않습니다.",
            s["warn"],
        )
    )

    story.append(Paragraph("1. 서비스 주소", s["h1"]))
    story.append(
        table(
            ["구분", "URL"],
            [
                ["고객 웹", CUSTOMER_URL],
                ["운영 콘솔 (키 발급)", OPS_URL],
                ["서버 상태", f"{BASE}/api/health"],
                ["개인정보 처리방침", PRIVACY_URL],
                ["Render 대시보드", "https://dashboard.render.com"],
            ],
            [55 * mm, 120 * mm],
            s,
        )
    )

    story.append(Paragraph("2. 요금 · 계좌 (고객 안내와 동일)", s["h1"]))
    story.append(
        table(
            ["항목", "내용"],
            [
                ["스탠다드", "월 9,900원 · 하루 8건 · 매월 15건 · 30일"],
                ["프리미엄", "월 19,900원 · 하루 15건 · 매월 30건 · 30일"],
                ["체험", "1건. 유료 플랜 전에만 발급"],
                ["추가 1건", "1,000원. 캡처와 미리보기 수정은 건수에 포함되지 않음"],
                ["한 화면", "최대 9칸. 문구 만들기 1회가 1건"],
                ["입금", BANK],
                ["입금 메모", "스탠다드 또는 프리미엄"],
                ["문의", CONTACT],
                ["키 전달 목표", "입금 확인 후 약 10분 이내"],
                ["같이 보낼 설명서", "스탠다드 PDF 또는 프리미엄 PDF 중 입금한 플랜"],
            ],
            [40 * mm, 135 * mm],
            s,
        )
    )

    story.append(Paragraph("3. 한 번만 하는 준비", s["h1"]))
    story.append(
        bullets(
            [
                "dashboard.render.com → 웹 서비스 AcrossEditor 열기",
                "Environment의 ADMIN_TOKEN이 운영 콘솔 비밀번호다. 고객에게 보내지 않는다.",
                "GEMINI_API_KEY가 있어야 문구가 만들어진다. 모델은 gemini-3.5-flash.",
                "키를 콘솔에만 두려면 운영 콘솔의 Gemini 키 칸에 저장한다. 저장 위치는 /var/data/gemini.key.",
                "라이선스 파일은 /var/data/licenses.json 이다. 디스크 acrosseditor-data 가 붙어 있어야 재배포 후에도 남는다.",
            ],
            font,
            s,
        )
    )

    story.append(Paragraph("4. 입금 후 키 발급", s["h1"]))
    story.append(
        Paragraph(
            "1) 통장 입금과 카톡/문자의 입금자명·메모(스탠다드/프리미엄)를 맞춘다.<br/>"
            f"2) {OPS_URL} 에 ADMIN_TOKEN으로 입장한다.<br/>"
            "3) 빠른 발급에서 해당 플랜 버튼을 누른다. 메모에 업체명·전화를 적는다.<br/>"
            "4) 나온 키와 해당 플랜 고객 PDF를 카톡/문자로 보낸다.<br/>"
            "5) 고객에게 크롬 확장 연결 설정의 서버 주소와 키 저장을 안내한다.<br/>"
            "버튼 대신 터미널로 발급할 때는 아래 curl을 쓴다. 여기토큰을 ADMIN_TOKEN으로 바꾼다.",
            s["body"],
        )
    )
    story.append(Paragraph("■ 스탠다드 1개월 (9,900원 · 30일)", s["h2"]))
    story.append(
        Paragraph(
            f"curl -X POST {BASE}/admin/licenses<br/>"
            "  -H \"Content-Type: application/json\"<br/>"
            "  -H \"X-Admin-Token: 여기토큰\"<br/>"
            "  -d '{\"plan\": \"standard\", \"days\": 30, \"note\": \"홍길동 스탠다드\"}'",
            s["code"],
        )
    )
    story.append(Paragraph("■ 프리미엄 1개월 (19,900원 · 30일)", s["h2"]))
    story.append(
        Paragraph(
            f"curl -X POST {BASE}/admin/licenses<br/>"
            "  -H \"Content-Type: application/json\"<br/>"
            "  -H \"X-Admin-Token: 여기토큰\"<br/>"
            "  -d '{\"plan\": \"premium\", \"days\": 30, \"note\": \"홍길동 프리미엄\"}'",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "지인 30일은 plan 을 family_standard 또는 family_premium 으로 둔다. "
            "체험 1건은 plan 을 trial 로 둔다. 한도와 기간은 플랜에 따라 서버가 정한다.",
            s["body"],
        )
    )
    story.append(Paragraph("■ 발급 목록 확인", s["h2"]))
    story.append(
        Paragraph(
            f"curl {BASE}/admin/licenses<br/>  -H \"X-Admin-Token: 여기토큰\"",
            s["code"],
        )
    )
    story.append(Paragraph("■ 고객에게 보낼 문구 예시", s["h2"]))
    story.append(
        Paragraph(
            "1분에디터 키가 발급됐습니다.<br/>"
            "키: (여기에 키)<br/>"
            "상품: 스탠다드(또는 프리미엄)<br/>"
            f"서버 주소: {BASE}<br/>"
            "크롬 확장 → 연결 설정에 서버 주소와 키를 저장한 뒤, 참고 페이지를 캡처하고 문구 만들기를 누르세요.<br/>"
            "스탠다드 고객에게는 스탠다드 PDF, 프리미엄 고객에게는 프리미엄 PDF를 같이 보내세요.",
            s["code"],
        )
    )

    story.append(Paragraph("5. 연장 · 정지 · 실패 1건", s["h1"]))
    story.append(Paragraph("연장 (같은 키)", s["h2"]))
    story.append(
        Paragraph(
            "운영 콘솔 목록의 +30일을 누릅니다. 터미널은 아래와 같습니다.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            f"curl -X POST {BASE}/admin/licenses/XXXX-XXXX-XXXX/extend<br/>"
            "  -H \"Content-Type: application/json\"<br/>"
            "  -H \"X-Admin-Token: 여기토큰\"<br/>"
            "  -d '{\"days\": 30}'",
            s["code"],
        )
    )
    story.append(
        Paragraph(
            "부분 입금은 연장 일수를 소수점 버림으로 계산합니다. "
            "스탠다드: 입금액 ÷ 9,900 × 30. 예: 4,950원 → 15일. "
            "프리미엄: 입금액 ÷ 19,900 × 30.",
            s["body"],
        )
    )
    story.append(Paragraph("정지 / 다시 활성", s["h2"]))
    story.append(
        Paragraph(
            f"curl -X POST {BASE}/admin/licenses/XXXX-XXXX-XXXX/status<br/>"
            "  -H \"Content-Type: application/json\"<br/>"
            "  -H \"X-Admin-Token: 여기토큰\"<br/>"
            "  -d '{\"status\": \"suspended\"}'<br/><br/>"
            "다시 쓰게 할 때는 status 를 active 로 보냅니다. 콘솔의 정지·활성 버튼과 같습니다.",
            s["code"],
        )
    )
    story.append(Paragraph("실패 건 1회 복구", s["h2"]))
    story.append(
        Paragraph(
            "문구 생성이 끝까지 실패하면 콘솔 오류 칸에 남습니다. "
            "그 줄의 1건 추가를 누르면 차감된 1건이 돌아옵니다. 키마다 한 번만 됩니다. "
            "고객이 추가 1건(1,000원)을 요청하면 메모에 남깁니다. 콘솔의 1건 추가는 실패로 깎인 건을 되돌리는 버튼입니다.",
            s["body"],
        )
    )

    story.append(Paragraph("6. 플랜 한도", s["h1"]))
    story.append(
        table(
            ["플랜", "코드", "하루", "이번 달", "비고"],
            [
                ["스탠다드", "standard", "8", "15", "월 9,900원 · 30일"],
                ["프리미엄", "premium", "15", "30", "월 19,900원 · 30일"],
                ["스탠다드 지인", "family_standard", "8", "15", "30일"],
                ["프리미엄 지인", "family_premium", "15", "30", "30일"],
                ["체험", "trial", "1", "1", "유료 전 1건"],
            ],
            [32 * mm, 38 * mm, 16 * mm, 22 * mm, 67 * mm],
            s,
        )
    )
    story.append(
        Paragraph(
            "상단 숫자는 남은 건/한도입니다. 스탠다드는 오늘 8/8 · 이번 달 15/15, "
            "프리미엄은 오늘 15/15 · 이번 달 30/30에서 시작합니다.",
            s["body"],
        )
    )

    story.append(Paragraph("7. 운영 체크리스트", s["h1"]))
    story.append(
        bullets(
            [
                f"배포 후 {BASE}/api/health 가 {{\"ok\": true}} 인지 확인",
                "고객 웹·운영 콘솔을 바꾼 뒤에는 main에 푸시한다. Render가 다시 배포한다.",
                "GEMINI_API_KEY와 ADMIN_TOKEN은 AcrossEditor 서비스에만 둔다. 고객 PDF와 카톡에 넣지 않는다.",
                "디스크 마운트는 /var/data, 라이선스 경로는 /var/data/licenses.json",
            ],
            font,
            s,
        )
    )

    story.append(Paragraph("8. 자주 막는 오류", s["h1"]))
    story.append(
        table(
            ["증상", "원인", "조치"],
            [
                ["키를 찾지 못함", "오타 또는 로컬에서 발급한 키", "운영 콘솔 목록에서 다시 확인"],
                ["입장 실패", "ADMIN_TOKEN 불일치", "Render Environment의 값을 다시 입력"],
                ["Gemini 키가 없습니다", "환경 변수·콘솔 키 없음", "GEMINI_API_KEY 또는 콘솔에서 키 저장"],
                ["첫 요청만 매우 느림", "Render가 잠에서 깨어남", "1분 대기 후 재시도"],
                ["한도 초과", "하루 또는 이번 달 건수 소진", "다음 주기, 연장, 또는 상위 플랜"],
                ["정지된 키입니다", "status가 suspended", "콘솔에서 활성"],
            ],
            [42 * mm, 55 * mm, 78 * mm],
            s,
        )
    )
    return story


def build_customer(s, font, plan_name, price_line, limit_line, plan_rows, extra_trouble, intro_tail):
    story = []
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("1분에디터", s["sub"]))
    story.append(Paragraph(f"고객 사용 방법 · {plan_name}", s["cover"]))
    story.append(Paragraph(f"{price_line}<br/>작성일: {WRITTEN}", s["sub"]))
    shared_start(story, s)

    story.append(Paragraph(f"2. {plan_name} 플랜", s["h1"]))
    story.append(table(["항목", "내용"], payment_rows(plan_rows), [45 * mm, 130 * mm], s))
    story.append(
        Paragraph(
            f"입금할 때 입금자명과 함께 메모에 「{plan_name}」을 적어 주세요. "
            "라이선스 키(예: ABCD-EFGH-IJKL)를 보내 드립니다. "
            "사이트에서 직접 결제하거나 키를 만드는 화면은 없습니다. "
            + intro_tail,
            s["body"],
        )
    )

    story.append(Paragraph("3. 문구 만들기", s["h1"]))
    story.append(bullets(usage_steps(plan_name), font, s))

    story.append(Paragraph("4. 알아 두실 점", s["h1"]))
    story.append(bullets(shared_notes(limit_line), font, s))

    story.append(Paragraph("5. 안 될 때", s["h1"]))
    story.append(trouble_table(s, extra_trouble))
    return story


def build_customer_standard(s, font):
    return build_customer(
        s,
        font,
        "스탠다드",
        "월 9,900원 · 하루 8건 · 매월 15건",
        "스탠다드는 하루 8건, 한 달 15건까지 문구를 만들 수 있습니다. 상단은 오늘 8/8 · 이번 달 15/15에서 시작합니다.",
        [
            ["플랜", "스탠다드"],
            ["요금", "월 9,900원 (30일)"],
            ["이용 한도", "하루 8건, 한 달 15건"],
            ["한 번에", "한 화면 최대 9칸. 문구 만들기 1회 = 1건"],
        ],
        [
            ["건수가 더 필요함", "추가 1건은 1,000원입니다. 매달 더 쓰려면 프리미엄(월 19,900원 · 하루 15건 · 매월 30건)으로 문의하세요."],
        ],
        "프리미엄은 하루 15건, 한 달 30건입니다.",
    )


def build_customer_premium(s, font):
    return build_customer(
        s,
        font,
        "프리미엄",
        "월 19,900원 · 하루 15건 · 매월 30건",
        "프리미엄은 하루 15건, 한 달 30건까지 문구를 만들 수 있습니다. 상단은 오늘 15/15 · 이번 달 30/30에서 시작합니다.",
        [
            ["플랜", "프리미엄"],
            ["요금", "월 19,900원 (30일)"],
            ["이용 한도", "하루 15건, 한 달 30건"],
            ["한 번에", "한 화면 최대 9칸. 문구 만들기 1회 = 1건"],
        ],
        [
            ["플랜이 스탠다드로 보임", "받은 키가 스탠다드일 수 있습니다. 키와 플랜 이름을 관리자에게 확인하세요."],
            ["건수가 더 필요함", "추가 1건은 1,000원입니다. 관리자에게 문의하세요."],
        ],
        "스탠다드보다 하루·달 한도가 큽니다.",
    )


def write_pdf(path, story, brand="1분에디터", doc_title=None):
    chrome = page_chrome(brand)
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title=doc_title or path.stem,
        author=brand,
    )
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    print(f"wrote {path}")


def main():
    font = register_font()
    s = styles(font)
    DOCS.mkdir(exist_ok=True)
    write_pdf(
        DOCS / "1분에디터_관리자_운영가이드.pdf",
        build_admin(s, font),
        doc_title="1분에디터 관리자 운영 가이드",
    )
    write_pdf(
        DOCS / "1분에디터_고객_사용방법_스탠다드.pdf",
        build_customer_standard(s, font),
        doc_title="1분에디터 고객 사용 방법 · 스탠다드",
    )
    write_pdf(
        DOCS / "1분에디터_고객_사용방법_프리미엄.pdf",
        build_customer_premium(s, font),
        doc_title="1분에디터 고객 사용 방법 · 프리미엄",
    )


if __name__ == "__main__":
    main()
