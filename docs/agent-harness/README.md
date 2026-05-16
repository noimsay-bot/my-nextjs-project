# Agent Harness README

## 목적
- 사람이 매번 자세히 설명하지 않아도 Codex가 같은 절차로 읽고, 판단하고, 구현하고, 검증하게 한다.
- 서비스 기능을 바꾸지 않고 문서, 검증 스크립트, CI, 리뷰 루프를 제공한다.

## 시작 순서
1. [../../AGENTS.md](../../AGENTS.md)를 읽는다.
2. [agent-routing.md](agent-routing.md)에서 호출할 역할을 고른다.
3. [review-loop.md](review-loop.md)의 기본 루프를 따른다.
4. [verification-checklist.md](verification-checklist.md)로 검증한다.
5. 문서 변경이 있으면 [doc-gardening.md](doc-gardening.md)를 따른다.

## 핵심 산출물
- 프롬프트 템플릿: [prompt-template.md](prompt-template.md)
- 사람에게 물어야 할 기준: [human-escalation.md](human-escalation.md)
- generated 문서: [../generated/README.md](../generated/README.md)

## 금지
- 하네스 스크립트가 실제 Supabase에 접속하지 않는다.
- 하네스 문서가 실제 환경변수 값을 기록하지 않는다.
- 검증 실패를 무시하고 성공처럼 보고하지 않는다.
