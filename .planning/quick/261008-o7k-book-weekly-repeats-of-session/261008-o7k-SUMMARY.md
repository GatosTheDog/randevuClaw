---
status: complete
---
# Summary
Client confirm step offers "Ναι, και τις επόμενες N" when business.allowMultiBooking and the same weekly class (catalogId) has later open dates (max 4, in window, within membership expiry). New cmenu:book:series:<id> books base + extras sequentially via shared bookOneInstance (enforcement per booking, one owner approval message each). Tests: tests/client-menu-series.test.ts.
