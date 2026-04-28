import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('data/events.json', 'utf8'));

// Helper: patch cost object on a record
function patchCost(record, patch) {
  record.cost = { ...record.cost, ...patch };
}

// Helper: apply update to record by id
function update(id, fn) {
  const r = data.records.find(x => x.id === id);
  if (!r) { console.warn('NOT FOUND:', id); return; }
  fn(r);
}

// ============================================================
// CONFIRMED PAID (were assumed free)
// ============================================================

update('kubecon-cloudnativecon-japan-2026-20260729', r => patchCost(r, {
  is_free: false, lowest_price: 249, price_currency: 'USD', cost_level: 'premium',
  notes: 'KubeCon Japan 2026 confirmed rates: Corporate standard $525 USD, Individual standard $249 USD, Academic $100 USD. Source: events.linuxfoundation.org/kubecon-cloudnativecon-japan/register/'
}));

update('observability-summit-20260521', r => patchCost(r, {
  is_free: false, lowest_price: 449, price_currency: 'USD', cost_level: 'premium',
  notes: 'Observability Summit 2026 confirmed rates: Standard $449 USD, Academic $100 USD. Source: events.linuxfoundation.org/observability-summit-north-america/register/'
}));

update('platform-summit-2026-20261012', r => patchCost(r, {
  is_free: false, lowest_price: 499, price_currency: 'EUR', cost_level: 'premium',
  notes: 'Platform Summit 2026 super early bird pricing (until June 8): EUR499 summit-only, EUR585 summit+unconference bundle. Source: nordicapis.com/events/platform-summit-2026/'
}));

update('devopsdays-dallas-2026', r => patchCost(r, {
  is_free: false, lowest_price: 200, price_currency: 'USD', cost_level: 'standard',
  notes: 'DevOpsDays Dallas 2026 general ticket $200 + 8.25% sales tax = $216.50. Source: devopsdays.org/events/2026-dallas/registration'
}));

update('sreday-london-q3-2026', r => patchCost(r, {
  is_free: false, lowest_price: 199, price_currency: 'GBP', cost_level: 'standard',
  notes: 'SREday London Q3 2026 Luma ticket prices: Self-funding GBP199, Early Bird GA GBP299 (until Jul 31), Full GA GBP399 (from Aug 1), Student/Job Seeker GBP49. Source: lu.ma embed event IKsbB1DCmfBEwHI'
}));

update('ai-infrastructure-summit-2026-20260928', r => patchCost(r, {
  is_free: false, lowest_price: 895, price_currency: 'EUR', cost_level: 'premium',
  notes: 'AI Infrastructure Summit 2026: Standard Event Pass EUR2549, Digital Event Pass EUR895. Co-located with Enterprise AI Summit, Big Data Minds, Business Intelligence Summit. Source: we-conect.com/events/ai-infrastructure-summit-2026'
}));

update('cloud-native-days-italy-2026-20260518', r => patchCost(r, {
  is_free: false, lowest_price: 160, price_currency: 'EUR', cost_level: 'standard',
  notes: 'Cloud Native Days Italy 2026: Regular ticket EUR160 ex. VAT (22%). Early Bird EUR100 and Very Early Bird EUR85 tiers have sold out. Source: cloudnativedaysitaly.org'
}));

update('atlanta-cloud-ai-conference-2026-20260530', r => patchCost(r, {
  is_free: false, lowest_price: 15, price_currency: 'USD', cost_level: 'low',
  notes: 'Atlanta Cloud+AI Conference advance ticket $15.00 + $1.30 service fee = $16.30 on TicketLeap. Community event by Developers Association of Georgia. Source: events.ticketleap.com'
}));

update('code-to-cloud-summit-2026-2qqpvpt8', r => patchCost(r, {
  is_free: false, lowest_price: 61.77, price_currency: 'CAD', cost_level: 'low',
  notes: 'Code To Cloud Summit 2026 Eventbrite: From CAD61.77 early bird (discount applied). Offer ends approximately May 2, 2026. Calgary, AB. Source: eventbrite.ca'
}));

update('aws-community-day-east-canada-2026-shg-q0yp', r => patchCost(r, {
  is_free: false, lowest_price: 22.63, price_currency: 'CAD', cost_level: 'low',
  notes: 'AWS Community Day East Canada 2026 Eventbrite: From CAD22.63 early bird. Community event, ticket revenue covers venue/event costs. Source: eventbrite.com/e/aws-community-day-montreal-tickets-1986733601684'
}));

update('aws-community-day-midwest-2026-i-4xw7vl', r => patchCost(r, {
  is_free: false, lowest_price: 25, price_currency: 'USD', cost_level: 'low',
  notes: 'AWS Community Day Midwest 2026: Conference pass $25.00 USD. Annual volunteer-run community event in Indianapolis. Source: awsmidwest.regfox.com/aws-community-day-midwest'
}));

update('the-cloud-ai-summit-2026-20260930', r => patchCost(r, {
  is_free: false, lowest_price: 700, price_currency: 'USD', cost_level: 'premium',
  notes: 'The Cloud & AI Summit 2026: All-access conference pass $900/person. Early bird $700 with code CAS26EarlyBird (expires April 30, 2026). Microsoft Azure/AI focused, 3 days. Source: cloudandaisummit.com/attend/register'
}));

// ============================================================
// CANCELLED
// ============================================================

update('cloud-native-days-amsterdam-zic3-bdy', r => {
  r.notes = 'CANCELLED: Cloud Native Days Amsterdam 2026 has been cancelled per official website announcement (cloudnative.amsterdam). Will return in 2027.';
});

// ============================================================
// CONFIRMED FREE (update notes from "assumed free")
// ============================================================

update('sreday-paris-q2-2026', r => patchCost(r, {
  lowest_price: 0,
  notes: 'Luma ticket page confirms: "This event is free to attend, woohoo!" Free Ticket and Community Hero types, both free. Source: lu.ma/embed/event/evt-DVJNFaWoytEvByr/simple'
}));

update('sreday-lisbon-q2-2026', r => patchCost(r, {
  lowest_price: 0,
  notes: 'Luma ticket page confirms: "This event is free to attend, woohoo!" Free Ticket and Community Hero types, both free. Source: lu.ma/embed/event/evt-Ho3Gp0nZFmNUjW0/simple'
}));

update('llmday-hamburg-2026', r => patchCost(r, {
  lowest_price: 0,
  notes: 'Luma ticket page confirms: "This event is free to attend, woohoo!" Free Ticket and Community Hero types, both free. Source: lu.ma/embed/event/evt-4zvCAzI2QDBdb3n/simple'
}));

update('llmday-lisbon-q2-2026', r => patchCost(r, {
  lowest_price: 0,
  notes: 'Luma ticket page confirms: "This event is free to attend, woohoo!" Free Ticket and Community Hero types, both free. Source: lu.ma/embed/event/evt-gNWNB8rIs45HwO4/simple'
}));

update('aws-community-lounge-at-aws-summit-hamburg-2026-8aemtioh', r => patchCost(r, {
  lowest_price: 0,
  notes: 'AWS Summit Hamburg 2026 confirmed as a free one-day event per official AWS page ("AWS Summit Hamburg is a free one-day event"). This community lounge is co-located with the free summit.'
}));

update('linuxfest-northwest-20260424', r => patchCost(r, {
  lowest_price: 0,
  notes: 'LinuxFest Northwest confirmed free. Sponsor prospectus states "FREE educational event celebrating Open Source Software". Event occurred April 24-26, 2026 in Bellingham, WA.'
}));

update('almalinux-day-los-angeles-20260718', r => patchCost(r, {
  lowest_price: 0,
  notes: 'AlmaLinux Day Los Angeles confirmed free. Registration via Indico (events.almalinux.org/event/189/) with no ticket cost. Community event by AlmaLinux OS Foundation.'
}));

// ============================================================
// PAID but price unknown — update notes only
// ============================================================

update('devopsdays-zurich-2026', r => patchCost(r, {
  notes: 'Confirmed paid conference via Tito ticketing, currently waitlist-only. Full ticket price not publicly published. Includes 2-day access, meals, evening event, and conference T-shirt.'
}));

update('kcd-toronto-canada-2026-2c-axqah', r => patchCost(r, {
  notes: 'KCD Toronto 2026 tickets via community.cncf.io require login to view pricing. Event description mentions early bird registration (ended March 1). Confirmed paid event, price not publicly visible.'
}));

update('kcd-new-york-2026', r => patchCost(r, {
  notes: 'KCD New York 2026 tickets at tickets.kcdnewyork.com. Cookie consent wall prevented price extraction. Confirmed paid community conference. Price not extractable.'
}));

update('kcd-sofia-2026-20260929', r => patchCost(r, {
  notes: 'KCD Sofia 2026 announced "Early Bird and Regular ticket sales soon" per official site. Sold out in 2025. Confirmed paid event, price not yet published as of April 2026.'
}));

update('kcd-uk-edinburgh-2026-20261019', r => patchCost(r, {
  notes: 'KCD UK Edinburgh 2026 tickets via community.cncf.io require login. Workshops are free; conference tickets are paid. Price not publicly visible.'
}));

update('aws-community-summit-manchester-2026-xsfgkpun', r => patchCost(r, {
  notes: 'AWS Community Summit Manchester 2026 (Oct 1, Victoria Warehouse) has earlybird tickets on sale per comsum.co.uk. Paid community event. Exact price not visible on public landing page.'
}));

update('aws-community-day-bulgaria-2026-ydc8fty3', r => patchCost(r, {
  notes: 'AWS Community Day Bulgaria 2026 (Oct 3, Sofia Tech Park) tickets via bilet.bg. Paid community event. Exact price not visible in crawl.'
}));

update('macsysadmin-20260929', r => patchCost(r, {
  notes: 'MacSysAdmin Conference 2026 (Sept 29 - Oct 2, Gothenburg, Sweden). 21st edition. No ticket prices published on the website as of April 2026.'
}));

update('devops-midwest-2026', r => patchCost(r, {
  notes: 'DevOps Midwest 2026 (Sept 16, Webster University, St. Louis, MO). Official site states "Tickets will be on sale soon." Confirmed paid event, price not yet published.'
}));

update('swiss-cloud-native-day-2026', r => patchCost(r, {
  notes: 'Swiss Cloud Native Day 2026 (Sept 17, Mount Gurten, Bern). Tito page shows "Tickets Are Available Soon" with waitlist. Discounted tickets for diversity/lower income. Paid event, exact price not yet published.'
}));

update('platform-con-live-day-new-york-bqbuaygj', r => patchCost(r, {
  is_free: false, cost_level: 'standard',
  notes: 'PlatformCon Live Day New York labeled "Tickets on sale" on platformcon.com homepage. In-person paid event. Specific ticket price not exposed in crawl.'
}));

update('platform-con-live-day-london-jkpies1t', r => patchCost(r, {
  is_free: false, cost_level: 'standard',
  notes: 'PlatformCon Live Day London labeled "Tickets on sale" on platformcon.com homepage. In-person paid event. (Virtual PlatformCon registration is separately free.) Specific ticket price not exposed in crawl.'
}));

// ============================================================
// Write output and validate
// ============================================================

writeFileSync('data/events.json', JSON.stringify(data, null, 2) + '\n');

const verify = JSON.parse(readFileSync('data/events.json', 'utf8'));
console.log('Total records:', verify.records.length, '| JSON valid: true');

// Spot-check a few
const checks = ['kubecon-cloudnativecon-japan-2026-20260729', 'sreday-paris-q2-2026', 'cloud-native-days-amsterdam-zic3-bdy'];
checks.forEach(id => {
  const r = verify.records.find(x => x.id === id);
  console.log(id, ':', JSON.stringify(r?.cost ?? r?.notes));
});
