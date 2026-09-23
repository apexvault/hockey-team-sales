# Master Product Specification

## Product

A team-sales operating system for hockey apparel and equipment serving teams, leagues, schools, captains, organizations, stores, and other approved wholesale buyers in the United States and Canada.

## Business objective

Create a repeatable lead-to-reorder system that makes it easy to sell, design, approve, produce, deliver, and reorder custom hockey uniforms and related apparel.

## Beta outcome

A customer and employee can complete the core path:

1. Lead or account creation
2. Product and pricing selection
3. Quote creation and acceptance
4. Artwork upload and designer collaboration
5. Proof review and approval
6. Roster and personalization collection
7. Payment or approved credit validation
8. Production handoff and status tracking
9. Shipment/delivery confirmation
10. Reorder from saved designs and prior orders

## Core user groups

- Admin
- Salesperson
- Designer
- Direct customer/team representative
- Invited team member
- Wholesale/store account
- Production/operations user

Claude must compare these roles with the implemented authorization model and document any difference rather than silently changing live permissions.

## Core commercial rules already established

- Wholesale access is invitation-only.
- Editable sample lifetime-spend discounts: $1,000 = 2%; $5,000 = 7%; $20,000 = 10%; $100,000+ = 20%.
- Wholesale accounts may apply for credit; approved orders cannot exceed available credit.
- Designer-to-customer site chat and email are mandatory; SMS is optional.
- Orders require visible pipeline status and searchable history.
- Designs must be stored for future reorder.

## Initial order statuses

NEW, NEEDS_ARTWORK, IN_DESIGN, AWAITING_APPROVAL, APPROVED, IN_PRODUCTION, QUALITY_CHECK, READY_TO_SHIP, SHIPPED, CLOSED.

Claude must audit current status names and preserve compatible production behavior. Any migration proposal is an owner gate.

## Beta exclusions unless already safely implemented

- Autonomous production deployment
- Unreviewed production database changes
- Unapproved paid services or purchases
- Broad ERP replacement
- Features that do not materially support the beta lead-to-reorder path

## Acceptance principle

A feature is not done merely because code exists. It requires acceptance criteria, permission checks, automated tests, a successful production build, and evidence that the relevant user workflow works on desktop and mobile.
