# Docs

The living documents stay at the repository root: `README.md` (how to run it), `AGENTS.md` (rules for AI agents), `ROADMAP.md` (the design) and `PROGRESS.md` (where things stand).

| Path | What it is | In git |
| --- | --- | --- |
| `demo-script.md` | The 10-minute demo, scene by scene, for the evaluation | yes |
| `altar-evaluation.md` | Review of Soban's original ALTAR and the four-step plan that rebuilt it | yes |
| `scope/` | The Scope Document and its presentation as text (`*.txt`), plus the PDFs | text only |
| `history/` | Earlier plans: the first implementation plan, the old ALTERA notes, the ALTER plan | text and images; Word files kept locally |
| `fyp/` | University documents: reports, SDS, presentations, meeting logs | no (kept locally) |

PDF, Word and PowerPoint files are never committed (`.gitignore`). To turn a PDF into text: `npm run read-pdf -- <file.pdf> <out.txt>`.
