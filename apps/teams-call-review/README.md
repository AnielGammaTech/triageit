# TriageIT Call Review for Microsoft Teams

This personal-scope Teams bot handles unmatched 3CX call reviews only.

## Package

The uploadable tenant package is `triageit-call-review.zip`. It contains only
the Teams manifest and required PNG icons.

After a Teams administrator uploads the package to the organization app
catalog, each technician installs **TriageIT Calls** in Teams, opens its private
chat, and sends `register` once.

The bot supports:

- `register` to enable private call-review cards
- `help` to show call-review instructions
- **Match and post** on an assigned card
- **Separate call** on an assigned card

It does not expose general agent chat, ticket search, arbitrary notes, Prison
Mike, or Toby.
