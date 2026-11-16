# NotePilot

**Less prep. More learning.** NotePilot turns lecture slides and class notes into flashcards, study guides, and short-answer practice exams.

Built for MGT 103 by team **Legally Bankrupt**: Jack Hindermann, Ryan Kropac, Maksimilian Lahu, William Parker.

## Features
- Upload PDF, PowerPoint (.pptx), Word (.docx), Markdown, or plain text, or paste notes directly
- Generate **flashcards** (term cards + fill-in-the-blank), a **study guide** (key terms and points by section), or a **practice exam** (short answer with model answers)
- Flip cards, mark what you know, shuffle, study unknown cards only, edit cards, and open the source excerpt
- Export flashcards to CSV for Quizlet or Anki
- Library with filters, search, and progress tracking
- Everything runs in the browser and is saved to localStorage, so there's no server and your notes stay private

## How generation works
Rule-based, no AI. Lines like `Term: definition`, `Term - definition`, or `X is/refers to/means Y` become definitions. Other sentences become key points and fill-in-the-blank cards. Headings (`# Heading`, `Heading:`, ALL CAPS lines, "Lecture 3 …") split notes into sections. Notes with one idea per line give the best results.

## Run locally
Open `index.html` in a browser, or serve the folder:
```
python3 -m http.server
```

## Deploy
Hosted with GitHub Pages from the `main` branch root.
