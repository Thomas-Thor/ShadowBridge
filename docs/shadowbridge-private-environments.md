# Future private environments — architectural direction only

This document records a future boundary. The current public website and
C.A.R.T.E.L. information page do not implement authentication or private access.
The footer lock icon identifies the invitation-only division; it does not imply
that the current information page is access protected.

## ShadowBridge Command Center

An owner-controlled administration environment for company operations, CRM,
counterparties, offers, opportunities, transactions, commissions, AI agents and
reports. Administrative permissions must be granted explicitly by the owner.

## C.A.R.T.E.L. Private Division

A separate members-only environment for individually invited and approved
partners. Access is limited to assigned projects, private opportunities,
cooperation, documents and assignments. Membership must never grant unrestricted
access to the ShadowBridge administrative system.

## Required future security boundary

A real backend must authenticate users and enforce authorization on every
request, including access to each project and document. Deny access by default
and grant the minimum necessary permissions. Client-side JavaScript, hidden
HTML, a lock icon and search-engine directives cannot enforce private access.

No backend, access-code system, database, private dashboard or paid service is
introduced by this footer update. This document is not part of the public build.
