#!/usr/bin/env python3
"""Build the unsigned iPhone share shortcut using only Python's standard library.

The plist token shape follows Apple's bundled WorkflowKit Gallery .wflow files.
Action identifiers/parameters were cross-checked against these public sources:
https://github.com/EachSheep/ShortcutsBench/blob/master/data/all_api2parasummary.json
https://github.com/viticci/shortcuts-playground-plugin/blob/main/codex/skills/shortcuts-playground/BEST_PRACTICES.md

This only writes a file. It does not access a user's Shortcuts database, install a
shortcut, read credentials, or call the app. Sign the result separately on macOS.
"""

import argparse
import plistlib
from pathlib import Path
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "https://insta-date-map.vercel.app"
DEFAULT_OUTPUT = ROOT / "shortcuts" / "instagram-save.unsigned.shortcut"
NAME = "데이트맵에 저장"
PLACEHOLDER = "\ufffc"


def identifier(label):
    return str(uuid5(NAMESPACE_URL, "https://datemap.local/shortcut/" + label)).upper()


def output(label, name):
    return {"Type": "ActionOutput", "OutputUUID": identifier(label), "OutputName": name}


def attachment(value):
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def text_token(value, prefix=""):
    # Shortcuts stores NSRange offsets in UTF-16 units, not Python characters.
    offset = len(prefix.encode("utf-16-le")) // 2
    return {
        "Value": {
            "string": prefix + PLACEHOLDER,
            "attachmentsByRange": {f"{{{offset}, 1}}": value},
        },
        "WFSerializationType": "WFTextTokenString",
    }


def action(kind, label, **parameters):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions." + kind,
        "WFWorkflowActionParameters": {"UUID": identifier(label), **parameters},
    }


def base_url(value):
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise argparse.ArgumentTypeError("배포 주소는 경로·계정 정보가 없는 https 주소여야 합니다.")
    return value.rstrip("/")


def build(app_url):
    group = identifier("has-url")
    found = output("detect-urls", "URLs")
    first = output("first-url", "Item from List")
    encoded = output("encode-url", "URL Encoded Text")
    destination = output("destination", "URL")
    fallback = output("fallback", "URL")
    actions = [
        action("comment", "instructions", WFCommentActionText=(
            "인스타그램 게시물이나 릴스를 공유할 때 이 단축어를 선택하세요. "
            "공유한 첫 번째 링크를 데이트맵의 장소 저장 화면으로 전달합니다. "
            "링크가 없으면 장소 저장 화면만 엽니다. PIN은 앱에서 입력합니다."
        )),
        action("detect.link", "detect-urls", WFInput=text_token({"Type": "ExtensionInput"})),
        action("conditional", "if-url", GroupingIdentifier=group, WFControlFlowMode=0,
               WFCondition=100, WFInput={"Type": "Variable", "Variable": attachment(found)}),
        action("getitemfromlist", "first-url", WFItemSpecifier="First Item", WFInput=attachment(found)),
        action("urlencode", "encode-url", WFEncodeMode="Encode", WFInput=text_token(first)),
        action("url", "destination", WFURLActionURL=text_token(encoded, app_url + "/add?url=")),
        action("openurl", "open-destination", WFInput=attachment(destination)),
        action("conditional", "otherwise", GroupingIdentifier=group, WFControlFlowMode=1),
        action("url", "fallback", WFURLActionURL=app_url + "/add"),
        action("openurl", "open-fallback", WFInput=attachment(fallback)),
        action("conditional", "end-if", GroupingIdentifier=group, WFControlFlowMode=2),
    ]
    workflow = {
        "WFWorkflowName": NAME,
        "WFWorkflowClientVersion": "4018.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFStringContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFQuickActionSurfaces": [],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowActions": actions,
    }
    validate(workflow)
    return workflow


def validate(workflow):
    """Catch broken variables/ranges/control flow before producing an artifact."""
    seen = set()
    groups = []

    def walk(value):
        if isinstance(value, dict):
            if value.get("Type") == "ActionOutput" and value["OutputUUID"] not in seen:
                raise ValueError("이전 동작을 가리키지 않는 단축어 변수가 있습니다.")
            if value.get("WFSerializationType") == "WFTextTokenString":
                token = value["Value"]
                raw = token["string"].encode("utf-16-le")
                if token["string"].count(PLACEHOLDER) != len(token["attachmentsByRange"]):
                    raise ValueError("단축어 문자열과 변수 개수가 다릅니다.")
                for region in token["attachmentsByRange"]:
                    start, length = map(int, region.strip("{}").split(","))
                    if length != 1 or raw[start * 2:(start + 1) * 2].decode("utf-16-le") != PLACEHOLDER:
                        raise ValueError("단축어 변수의 문자열 위치가 올바르지 않습니다.")
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    for step in workflow["WFWorkflowActions"]:
        params = step["WFWorkflowActionParameters"]
        walk(params)
        if step["WFWorkflowActionIdentifier"] == "is.workflow.actions.conditional":
            group, mode = params["GroupingIdentifier"], params["WFControlFlowMode"]
            if mode == 0:
                groups.append(group)
            elif not groups or groups[-1] != group:
                raise ValueError("단축어 조건 분기의 연결이 올바르지 않습니다.")
            elif mode == 2:
                groups.pop()
        seen.add(params["UUID"])
    if groups:
        raise ValueError("닫히지 않은 단축어 조건 분기가 있습니다.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", type=base_url, default=DEFAULT_BASE_URL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="파일을 쓰지 않고 현재 생성 결과와 같은지 확인")
    args = parser.parse_args()
    content = plistlib.dumps(build(args.base_url), fmt=plistlib.FMT_BINARY, sort_keys=True)
    if args.check:
        if not args.output.is_file() or args.output.read_bytes() != content:
            parser.exit(1, "단축어 원본을 다시 생성해 주세요.\n")
        print("단축어 원본과 생성 코드가 일치합니다.")
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(content)
    print(f"서명 전 단축어를 만들었습니다: {args.output}")


if __name__ == "__main__":
    main()
