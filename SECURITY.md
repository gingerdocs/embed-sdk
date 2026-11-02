# Security

## Reporting a vulnerability

**Please do not open a public issue.**

Email **security@gingerdocs.com** with what you found, how to reproduce it, and how you would like to
be credited. We will acknowledge within two business days and keep you updated until it is resolved.

We will not take legal action against research conducted in good faith: testing only against your
own account and test-environment data, no access to other people's documents, no denial of service,
and no social engineering.

## What is in scope

This repository — the two npm packages and the playground. Also in scope, and more interesting:

- Anything that gets a **secret key into a browser**. The entire model rests on that never happening.
- A way to open a session on an **origin that was not registered** for it.
- A `postMessage` accepted from an origin or a session it should not have been.
- A session URL that works after expiry, after revocation, or for a different session.

## What is not

- Anything requiring physical access to a user's machine, or a browser extension they installed.
- Reports of missing headers with no demonstrated impact.
- Findings against `gd_pk_…` **publishable** keys being visible in page source. They are public by
  design — every endpoint they reach is world-readable given a handle the caller already holds.
- Volumetric denial of service.

## What the SDK deliberately does not do

Worth knowing before you look, because their absence is a design decision rather than an oversight:

- It never holds an API key of any kind.
- It never calls the GingerDocs API. It moves `postMessage` between two windows.
- It never renders document content. That happens inside the frame, on our origin, where the
  content is sanitised.
- It never writes to `localStorage` or `sessionStorage`. Session credentials belong in a URL
  fragment that is read once and erased.
