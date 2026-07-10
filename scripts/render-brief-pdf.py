#!/usr/bin/env python3
"""Render Arnold's morning brief (markdown-lite) into a branded PDF.

Usage: render-brief-pdf.py input.md output.pdf
Supports: # h1, ## h2, ### h3, - bullets, plain paragraphs, --- rules.
Text is latin-1-sanitized (emoji stripped) for the built-in fonts.
"""
import re
import sys

from fpdf import FPDF

CRIMSON = (158, 32, 32)
INK = (18, 18, 18)
GRAY = (135, 127, 122)


def clean(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)  # bold markers (styling handled per-line)
    return s.encode("latin-1", "ignore").decode("latin-1").strip()


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    lines = open(src, encoding="utf-8").read().splitlines()

    pdf = FPDF(format="letter")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_margins(18, 16, 18)

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            pdf.ln(2)
            continue
        if line.startswith("### "):
            pdf.set_font("helvetica", "B", 11)
            pdf.set_text_color(*INK)
            pdf.multi_cell(0, 6, clean(line[4:]))
            pdf.ln(1)
        elif line.startswith("## "):
            pdf.ln(2)
            pdf.set_font("helvetica", "B", 13)
            pdf.set_text_color(*CRIMSON)
            pdf.multi_cell(0, 7, clean(line[3:]))
            pdf.set_draw_color(*CRIMSON)
            pdf.set_line_width(0.3)
            pdf.line(18, pdf.get_y(), 100, pdf.get_y())
            pdf.ln(2)
        elif line.startswith("# "):
            pdf.set_font("times", "B", 20)
            pdf.set_text_color(*INK)
            pdf.multi_cell(0, 9, clean(line[2:]))
            pdf.ln(1)
        elif line.strip() == "---":
            pdf.set_draw_color(220, 214, 205)
            pdf.line(18, pdf.get_y() + 1, 198, pdf.get_y() + 1)
            pdf.ln(3)
        elif line.lstrip().startswith("- "):
            indent = (len(line) - len(line.lstrip())) // 2
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(*INK)
            pdf.set_x(18 + 4 + indent * 4)
            pdf.multi_cell(0, 5.2, "\x95 " + clean(line.lstrip()[2:]))
        elif line.startswith("> "):
            pdf.set_font("helvetica", "I", 9.5)
            pdf.set_text_color(*GRAY)
            pdf.set_x(24)
            pdf.multi_cell(0, 5, clean(line[2:]))
        else:
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(*INK)
            pdf.multi_cell(0, 5.2, clean(line))

    pdf.output(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
