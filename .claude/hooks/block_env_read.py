# -*- coding: utf-8 -*-
"""검문 훅 — 터미널 명령으로 .env 를 열어 보지 못하게 막는다.

언제 도나
    Claude Code가 명령을 실행하기 직전(PreToolUse). Bash · PowerShell 명령마다 돈다.

무엇을 보나
    그 명령의 글자 자체. 명령 이름(cat, head, grep, python …)과 상관없이
    .env 또는 .env.local 같은 .env.* 파일을 가리키는 말이 들어 있으면 잡는다.
      - 경로를 붙여 써도 잡는다      ./.env   /어딘가/.env   C:\\proj\\.env
      - 따옴표로 쪼개도 잡는다       .en""v   '.env'
      - 변수에 담아도 잡는다         f=.env; cat $f
      - 와일드카드로 가려도 잡는다   .e*   .env*   .[e]nv   .*
    견본 파일(.env.example · .env.sample · .env.template · .env.dist)은 통과시킨다.

무엇을 하나
    걸리면 exit 2 로 그 명령을 막고, 왜 막았는지 알려 준다.

무엇을 하지 않나
    파일을 고치거나 지우지 않는다. 밖으로 아무것도 보내지 않는다.
    폴더 전체를 훑는 명령(grep -r KEY . · tar · cp -r)처럼 .env 라는 이름을 쓰지 않고
    읽는 경우까지는 잡지 못한다. 이 훅은 "이름을 대고 여는 것"을 막는 문이다.

설정 (.claude/settings.json)
    "hooks": { "PreToolUse": [ { "matcher": "Bash|PowerShell",
        "hooks": [ { "type": "command", "command": "python",
                     "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/block_env_read.py"] } ] } ] }
"""
import fnmatch
import json
import re
import sys

# 견본 파일 — 값이 비어 있으니 열어도 된다
ALLOWED = {".env.example", ".env.sample", ".env.template", ".env.dist"}

# 앞: 줄 처음 · 빈칸 · 경로 구분자 · = · 셸 기호 / 뒤: 줄 끝 · 빈칸 · 셸 기호
ENV_NAME = re.compile(r"(?:^|(?<=[\s/=<>|;&(:,`]))(\.env(?:\.[A-Za-z0-9_.-]+)?)(?=$|[\s|;&)<>,`])")
TOKEN = re.compile(r"[^\s|;&()<>`]+")
GLOB_CHARS = set("*?[")
# 와일드카드 검사에 쓰는 실제 파일 이름 예시 — 이 중 하나라도 맞으면 막는다
PROBES = [".env", ".env.local", ".env.production", ".env.development"]


def variants(command):
    """따옴표 쪼개기 · 백슬래시를 풀어 본 여러 모양."""
    no_quotes = command.replace('"', "").replace("'", "")
    return {
        command,
        no_quotes,
        no_quotes.replace("\\", ""),      # .en\v  → .env
        no_quotes.replace("\\", "/"),     # C:\proj\.env → C:/proj/.env
    }


def named_env(text):
    for m in ENV_NAME.finditer(text):
        name = m.group(1).rstrip(".")
        if name not in ALLOWED:
            return name
    return None


def globbed_env(text):
    for tok in TOKEN.findall(text):
        last = tok.replace("\\", "/").rsplit("/", 1)[-1]
        # 셸 와일드카드는 점으로 시작하는 파일을 점을 직접 써야만 고른다 (ls * 는 .env 를 안 고른다)
        if not last.startswith(".") or not (GLOB_CHARS & set(last)):
            continue
        for probe in PROBES:
            if fnmatch.fnmatchcase(probe, last):
                return tok
    return None


def main():
    # 윈도우 기본 문자표(cp949)로 알림을 쓰다 죽으면 막지 못하고 통과되므로 UTF-8 로 못 박는다
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace"))
    except Exception:
        return 0                        # 읽을 수 없는 입력이면 막지 않는다
    command = str((data.get("tool_input") or {}).get("command") or "")
    if not command:
        return 0
    for text in variants(command):
        hit = named_env(text)
        how = "파일 이름"
        if not hit:
            hit = globbed_env(text)
            how = "와일드카드"
        if hit:
            print("검문 훅이 막았습니다 — 명령이 .env 파일을 가리키고 있습니다.\n"
                  f"  {how}  {hit}\n"
                  ".env 에는 실제 열쇠가 들어 있어 대화에 옮겨지면 안 됩니다. "
                  "변수 이름만 필요하면 .env.example 을 보십시오.\n"
                  "꼭 확인해야 하면 사람이 편집기에서 직접 엽니다.", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
