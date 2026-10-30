// same clock as GitHub Actions (UTC), set before the xlsx library loads (it fixes its date base when
// loaded): otherwise the dates of the POSCO format come out a day early. Import it first.
process.env.TZ = 'UTC';
