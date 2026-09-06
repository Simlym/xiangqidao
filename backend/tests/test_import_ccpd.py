from pathlib import Path

from app.modules.puzzles.importer.import_ccpd import convert_dataset, notation_to_uci


INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


def test_notation_to_uci_accepts_big5_style_fullwidth_numbers():
    assert notation_to_uci(INITIAL_FEN, "炮二平五") == "h2e2"
    after_red = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1"
    assert notation_to_uci(after_red, "馬８進７") == "h9g7"


def test_convert_dataset_outputs_curriculum_fields(tmp_path: Path):
    opening = tmp_path / "開局"
    opening.mkdir()
    content = f'''[Game "Chinese Chess"]
[Event "中炮對屏風馬"]
[Result "*"]
[ECCO "C44"]
[FEN "{INITIAL_FEN}"]

1. 炮二平五 馬８進７
2. 馬二進三 *
'''
    (opening / "00000001.pgn").write_bytes(content.encode("big5"))
    items, report = convert_dataset(tmp_path, {"开局": 1, "中局": 0, "残局": 0})

    assert report["added"] == {"开局": 1}
    assert items[0]["solution"] == ["h2e2", "h9g7", "h0g2"]
    assert items[0]["kind"] == "开局"
    assert items[0]["category"] == "中炮"
    assert items[0]["verified"] is False


def test_engine_match_marks_item_verified(tmp_path: Path):
    opening = tmp_path / "開局"
    opening.mkdir()
    content = f'''[Game "Chinese Chess"]
[Event "中炮"]
[FEN "{INITIAL_FEN}"]

1. 炮二平五 馬８進７ 2. 馬二進三 *
'''
    (opening / "1.pgn").write_bytes(content.encode("big5"))

    class MatchingEngine:
        def bestmove(self, fen, movetime_ms):
            return "h2e2"

    items, report = convert_dataset(
        tmp_path, {"开局": 1, "中局": 0, "残局": 0}, engine=MatchingEngine()
    )
    assert items[0]["verified"] is True
    assert report["verified"] == {"开局": 1}
