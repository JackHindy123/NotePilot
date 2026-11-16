# NotePilot

**Less prep. More learning.** NotePilot turns lecture slides and class notes into flashcards, study guides, and short-answer practice exams.

Built for MGT 103 by team **Legally Bankrupt**: Jack Hindermann, Ryan Kropac, Maksimilian Lahu, William Parker.

## Features
- Upload PDF, PowerPoint (.pptx), Word (.docx), Markdown, plain text, or photos (JPG/PNG), or paste notes directly
- Scanned PDFs, photos, and handwritten notes are read with in-browser text recognition (Tesseract.js); neat handwriting works best, and you can edit the recognized text before generating
- Generate **flashcards** (term cards + fill-in-the-blank), a **study guide** (key terms and points by section), or a **practice exam** (short answer with model answers)
- Flip cards, mark what you know, shuffle, study unknown cards only, edit cards, and open the source excerpt
- Export flashcards to CSV for Quizlet or Anki
- Library with filters, search, and progress tracking
- Notes and study sets are saved in the browser (localStorage); rule-based mode never sends anything to a server

## AI mode (optional)
With a free Cloudflare Worker and a free Google Gemini API key, NotePilot uses Gemini to read handwriting and scans and to write flashcards, study guides, and practice exams. See [SETUP-AI.md](SETUP-AI.md). Without it, everything below still works for free in the browser.

## How rule-based generation works
No AI. Lines like `Term: definition`, `Term - definition`, or `X is/refers to/means Y` become definitions. Other sentences become key points and fill-in-the-blank cards. Headings (`# Heading`, `Heading:`, ALL CAPS lines, "Lecture 3 …") split notes into sections. Notes with one idea per line give the best results.

## Run locally
Open `index.html` in a browser, or serve the folder:
```
python3 -m http.server
```

## Deploy
Hosted with GitHub Pages from the `main` branch root.
