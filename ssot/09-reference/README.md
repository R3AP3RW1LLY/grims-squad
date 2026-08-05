# Reference documents

Markdown or plain text dropped in here is ingested into GMSD AI's knowledge base as the
`reference` source, chunked into passages and embedded.

## What belongs here

Material the assistant should know **verbatim** and that is not a forum post:

- how a game mechanic actually works
- the journal event reference
- squadron procedure an officer wants quoted back accurately

## What does not

- **Anything scraped from a wiki.** The licensing is unclear for redistribution through an
  assistant, the markup changes without warning, and an assistant confidently quoting an edit
  somebody made five minutes ago is worse than one that says it does not know. Everything in here
  should be content this squadron owns and can correct.
- **Anything secret.** There is no per-member filtering after the knowledge table. A document here
  is a document every member can be told about.

## How it is split

Long documents are chunked on blank lines at roughly 1,200 characters, and every chunk carries the
document title. A whole guide embedded as one vector is the AVERAGE of everything it discusses and
is therefore close to nothing in particular — it gets returned for every question and answers none
of them well.

So: **write in paragraphs, and keep each paragraph about one thing.** That is what makes a passage
retrievable.
