"""SM-2 算法核心行为测试。"""

from datetime import date

from app.srs import SrsState, review


def test_first_correct_interval_is_one_day():
    s = review(SrsState(), quality=4, today=date(2026, 1, 1))
    assert s.repetitions == 1
    assert s.interval == 1
    assert s.next_review == date(2026, 1, 2)


def test_second_correct_interval_is_six_days():
    s = review(SrsState(), quality=4, today=date(2026, 1, 1))
    s = review(s, quality=4, today=date(2026, 1, 2))
    assert s.repetitions == 2
    assert s.interval == 6


def test_third_correct_uses_ease_factor():
    s = review(SrsState(), quality=5, today=date(2026, 1, 1))
    s = review(s, quality=5, today=date(2026, 1, 2))
    prev = s
    s = review(s, quality=5, today=date(2026, 1, 8))
    assert s.repetitions == 3
    assert s.interval == round(prev.interval * prev.ease_factor)


def test_wrong_resets_repetitions_and_shortens_interval():
    s = review(SrsState(), quality=4, today=date(2026, 1, 1))
    s = review(s, quality=4, today=date(2026, 1, 2))  # interval 6
    s = review(s, quality=1, today=date(2026, 1, 8))  # 答错
    assert s.repetitions == 0
    assert s.interval == 1


def test_ease_factor_never_below_minimum():
    s = SrsState()
    for _ in range(10):
        s = review(s, quality=0)
    assert s.ease_factor >= 1.3
