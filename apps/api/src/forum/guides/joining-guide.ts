/**
 * The joining guide, as Markdown.
 *
 * ★ WHY THIS IS SOURCE AND NOT A ROW IN A MIGRATION ★
 *
 * Squadron owner, 2026-07-29: "create ultra detailed step by step guides on how to
 * join the squadron, assume the people joining do not have an inara account ... also
 * include how to download the companion app and how to connect it etc. assume anyone
 * using this guide has no idea how to do anything when it comes to joining".
 *
 * Written here rather than as HTML pasted into SQL for two reasons. It goes through
 * the SAME `renderPostBody` every member post goes through, so the guide cannot be a
 * back door past INV-035 — a seeded post with hand-written HTML would be the one
 * piece of stored markup nothing sanitised. And it is reviewable: this is prose that
 * will need editing every time Inara moves a button, and prose belongs in a diff.
 *
 * ★ THE ORDER IS THE OWNER'S, EXACTLY ★
 *
 * "1. join the discord, 2 create inara, 3 connect inara to frontier, 4 apply on inara
 * to join the squadron, 5 apply to the squadron in game, 6 verify inara in our
 * application after they have been accepted to the squadron in game and on inara."
 *
 * That sequence is not arbitrary and the guide says why at each step: verification
 * last, because it checks facts that only become true once the earlier steps have
 * been accepted by somebody.
 *
 * ★ SCREENSHOT PLACEHOLDERS ARE TEXT, NOT IMAGES — AND THAT IS A LIMITATION ★
 *
 * The owner asked for "placeholder areas for me to be able to add screenshot images
 * etc to illistrate". The sanitiser does not allow `img`: uploads land at P2.3 with
 * their own EXIF-stripping and polyglot handling, and allowing remote images before
 * then would let a post leak every reader's IP to a third-party host.
 *
 * So each placeholder is a marked block saying exactly what to capture. They read as
 * deliberate gaps rather than broken images, and at P2.3 they become the checklist of
 * shots to take.
 *
 * ★ WHERE I AM NOT CERTAIN, THE GUIDE SAYS SO ★
 *
 * Inara's and Frontier's interfaces change, and I cannot see them from here. Steps
 * that depend on a third-party label describe WHERE to look and WHAT the control does
 * rather than asserting a menu path I cannot verify — and the placeholder alongside is
 * what will make it unambiguous. Inventing exact labels would produce a guide that
 * reads more confidently and helps less.
 */

/** A marked gap for a screenshot, phrased as an instruction to whoever captures it. */
const shot = (what: string): string =>
  `> **📷 SCREENSHOT NEEDED —** ${what}\n>\n> _(Placeholder. Image uploads arrive in a later release; until then this block is where the picture goes.)_`;

export interface GuidePost {
  readonly bodyMd: string;
}

export interface GuideThread {
  readonly slug: string;
  readonly title: string;
  /** Public on the open internet. Every joining guide is, by definition. */
  readonly isPublic: boolean;
  readonly posts: readonly GuidePost[];
}

const OVERVIEW = `
# Joining Grim's Squad

Welcome, Commander. This guide takes you from "I have never heard of Inara" to a
verified member of Grim's Squad. It assumes you know nothing about any of the tools
involved, and it does not skip steps.

Read this page first, then work through the six steps in order.

## What you will need

- **Elite Dangerous** on PC (Odyssey).
- A **Discord** account. Free, takes two minutes.
- An **Inara** account. Also free, and step 2 creates it for you.
- About **20 minutes**, plus however long it takes an officer to approve you.

## The six steps, in order

1. **Join our Discord.** Everything else starts here.
2. **Create an Inara account.**
3. **Connect Inara to your Frontier account.**
4. **Apply to the squadron on Inara.**
5. **Apply to the squadron in game.**
6. **Verify your Inara link on this website.**

## Why the order matters

Steps 4 and 5 are two different applications to two different systems, and both need
a human to accept them. Step 6 checks that this has actually happened — it reads your
real commander record and confirms you are who you say you are and that you are in the
squadron.

That is why verification is last. Run it too early and it will correctly tell you it
cannot confirm anything yet, which looks like a broken website when it is really just
an honest answer to a question asked too soon.

Work through them in order and each step will have what it needs.

## If you get stuck

Ask in Discord. Somebody will answer, and if a step in this guide is wrong or
out of date we would rather hear about it than have the next person hit the same wall.
`;

const STEP_1 = `
# Step 1 — Join our Discord

Discord is where the squadron actually talks. Wings form there, operations get
organised there, and it is where you ask for help.

**Membership of our Discord is required to use these forums.** That is deliberate: it
means everybody posting here is somebody the squadron can reach.

## 1a. Get a Discord account

If you already have one, skip to 1b.

1. Go to **https://discord.com** and select **Register**.
2. Enter an email address, a username and a password.
3. Confirm your email address — Discord sends you a link, and your account is limited
   until you click it.

${shot('the Discord registration form, filled in with example details')}

## 1b. Join the squadron server

1. Open our invite link: **[ ASK IN GAME OR ON INARA FOR THE CURRENT INVITE LINK ]**

   > **⚠️ To the person maintaining this guide:** replace the line above with the real
   > permanent invite. It is deliberately not guessed here — a wrong invite link is
   > worse than none, because it sends new commanders somewhere else entirely.

2. Discord will ask you to confirm you want to join. Accept.
3. You will land in the server. Read the welcome channel — it will tell you where to
   introduce yourself.

${shot('the Discord invite screen showing the Grim\'s Squad server, with the Accept Invite button')}

## 1c. Say hello

Post a short introduction. Your commander name, roughly what you like doing in the
galaxy, and whether you are new to the game. This is how an officer knows to look out
for your application in the next steps.

${shot('an example introduction message in the Discord welcome channel')}

**Done?** Go to step 2.
`;

const STEP_2 = `
# Step 2 — Create an Inara account

Inara is a community-run companion site for Elite Dangerous. The squadron uses it as
the shared record of who is a member and what everybody has been doing.

You need an account there. It is free.

## 2a. Register

1. Go to **https://inara.cz**.
2. Find the **register** or **sign up** option — on Inara this sits in the top-right
   area of the page alongside the login control.
3. Enter a username, an email address and a password.
4. Confirm your email address if Inara asks you to.

${shot('the Inara front page with the register/login controls in the top-right visible')}

${shot('the Inara registration form')}

## 2b. Set your commander name

This is the part people miss, and it matters: your Inara account and your in-game
commander are two different things until you tell Inara who you are.

1. Once logged in, open your own profile — your username in the top-right opens a menu
   containing your profile and settings.
2. Find the commander section of your profile.
3. Enter your **in-game commander name**, spelled exactly as it appears in Elite
   Dangerous. Capitalisation does not usually matter but spelling absolutely does.

${shot('the Inara profile menu opened, showing the profile and settings entries')}

${shot('the commander name field on the Inara profile, filled in')}

> **Why exactly?** Step 6 matches your Inara commander name against squadron records.
> A typo here means verification fails later with a message that will not obviously
> point back to this field.

**Done?** Go to step 3.
`;

const STEP_3 = `
# Step 3 — Connect Inara to your Frontier account

This is what turns your Inara profile from "a name I typed in" into a verified record
of your actual commander. Inara asks Frontier directly for your commander data, so
what appears on Inara is what is really true in game.

## 3a. Find the Frontier link setting

1. On Inara, open your **settings** from the menu under your username.
2. Look for the section dealing with your **Frontier account** or **game data
   sync**. Inara uses Frontier's official companion API for this.
3. Start the link.

${shot('the Inara settings page with the Frontier account / game data section visible')}

## 3b. Authorise it at Frontier

1. You will be sent to a **Frontier** page — check the address bar says a Frontier
   domain before you type anything.
2. Sign in with the **same Frontier account you play Elite Dangerous on**. This is
   your Frontier store login, not your Steam login.
3. Frontier will email you a **verification code**. Enter it.
4. Approve the request.

${shot('the Frontier authorisation page asking to sign in')}

${shot('the Frontier verification-code prompt')}

> **🔒 A word on safety.** You are signing in **at Frontier**, on Frontier's own site.
> Inara never sees your Frontier password. If any page that is not on a Frontier
> domain asks for that password, stop — that is not this process.

## 3c. Confirm it worked

Back on Inara, your profile should now show real data pulled from the game: your ship,
your credit balance, your ranks. If it still shows nothing, give it a few minutes and
reload — the first sync is not instant.

${shot('an Inara commander profile showing synced game data — ship, ranks, location')}

**Done?** Go to step 4.
`;

const STEP_4 = `
# Step 4 — Apply to the squadron on Inara

Now you ask to join us on Inara. An officer sees the request and accepts it.

## 4a. Find us

Search Inara for our squadron by name: **Grim's Squad**.

Our player minor faction is **[Blood Brothers from Alrai](https://inara.cz/elite/minorfaction/5469/)**,
and our home system is
**[Hyades Sector AV-W b2-4](https://inara.cz/elite/starsystem/778467/)** — useful for
confirming you have found the right group.

> **⚠️ To the person maintaining this guide:** add the direct Inara **squadron** link
> here. The two links above are the faction and the system, which are not the same
> page as the squadron, and it is not guessed for you — a wrong squadron link would
> send applications to somebody else's group.

${shot('Inara squadron search results with Grim\'s Squad visible')}

## 4b. Apply

1. Open the squadron page.
2. Select the option to **apply** or **request to join**.
3. If there is a message box, say who you are and mention that you are already in the
   Discord. It makes approving you a two-second decision instead of a question.

${shot('the Inara squadron page with the apply/join control visible')}

${shot('the application form with an example message')}

## 4c. Wait to be accepted

An officer has to accept this. Post in Discord that you have applied — it is the
fastest way to get somebody to look.

**Do not run step 6 yet.** Verification checks facts that are not true until this
application and the in-game one in step 5 have both been accepted.

**Done?** Go to step 5.
`;

const STEP_5 = `
# Step 5 — Apply to the squadron in game

Inara and Elite Dangerous keep separate records. Joining on Inara does not join you in
game, so this step is not a repeat of step 4 — both are required.

## 5a. Open the squadrons screen

1. Launch **Elite Dangerous**.
2. From the main menu, or from the in-game right-hand panel, open **Squadrons**.
3. If you are not in a squadron you will see options to create or find one.

${shot('the Elite Dangerous main menu with the Squadrons option')}

${shot('the Squadrons screen for a commander not currently in a squadron')}

## 5b. Search and apply

1. Choose the option to **search** for a squadron.
2. Type **Grim's Squad**.
3. Select us in the results, then choose **apply** / **request to join**.

${shot('the in-game squadron search with results showing Grim\'s Squad')}

${shot('the in-game squadron detail page with the apply button')}

> **Careful:** squadron names in Elite are not unique. Check the details match — our
> home system is **Hyades Sector AV-W b2-4** and our faction is **Blood Brothers from
> Alrai**. If those do not match, it is a different group with a similar name.

## 5c. Accept the invite when it arrives

Once an officer approves you, the invitation appears **in game**.

1. Open **Squadrons** again.
2. Look for your pending invitation or application — it appears on the squadrons
   screen once there is something to respond to.
3. **Accept** it.
4. You are in. Your squadron tag will appear next to your commander name.

${shot('the in-game notification or squadrons screen showing a pending squadron invitation')}

${shot('the accept-invitation confirmation')}

${shot('a commander profile showing the squadron tag after joining')}

> **Nothing there?** Invitations do not always appear instantly, and a menu that was
> already open will not refresh itself. Back out to the main menu and return to
> Squadrons. If it is still empty after a while, say so in Discord — an officer can
> check whether the approval actually went through.

**Done?** Go to step 6 — the last one.
`;

const STEP_6 = `
# Step 6 — Verify your Inara link on this website

Last step. This connects your website account to your verified commander record, and
it is what turns you from a visitor into a member here.

**Only do this once steps 4 and 5 are both accepted.** Verification checks facts that
are not true before then.

## 6a. Sign in here

Sign in to this website with Discord. You are already in our Discord from step 1, so
there is nothing new to join.

${shot('the Grim\'s Squad sign-in page')}

## 6b. Generate an Inara API key

An API key is a long string of characters that lets one site ask another site for your
data, without you handing over your password.

1. Log in to **https://inara.cz**.
2. Open your **settings** from the menu under your username.
3. Find the **API** section. Inara keeps API keys in your account settings alongside
   the other integration options.
4. Create a new key. Give it a recognisable name — **Grim's Squad Hub** — so you know
   later what it was for.
5. **Copy the key.** Inara may show it only once.

${shot('the Inara settings page with the API section visible')}

${shot('the Inara API key generation form, with the name field filled in as “Grim’s Squad Hub”')}

${shot('a generated Inara API key with the copy control (blur the key itself before sharing this screenshot)')}

> **🔒 Treat the key like a password.** It is not your Inara password and it cannot be
> used to log in as you — but it can read your data, so do not paste it into Discord,
> and blur it in any screenshot. If you ever paste it somewhere by accident, delete it
> on Inara and generate a new one. That immediately makes the old one useless.

## 6c. Paste it into your commander settings

1. On this website, go to **Settings → Commander**.
2. Find the Inara section.
3. Paste your API key into the field.
4. Save.

${shot('the Settings → Commander page showing the Inara API key field')}

${shot('the same page after saving, showing the verified state')}

## 6d. What happens next

The site contacts Inara, reads your commander record, and confirms it matches. It
updates as soon as the answer comes back — there is nothing to refresh and no page to
reload.

Once verified, the members' areas open up.

## If verification does not succeed

Work through these in order — the first is by far the most common:

- **Your in-game commander name does not exactly match the one on Inara.** Go back to
  step 2b and check the spelling character by character.
- **Your Inara squadron application has not been accepted yet** (step 4).
- **Your in-game squadron invite has not been accepted yet** (step 5) — including the
  case where an officer approved you but you never accepted the invitation in game.
- **The key was copied incompletely.** These are long; a partial paste is easy. Copy it
  again, or generate a fresh one.
- **Inara has not finished syncing** from Frontier (step 3c).

Still stuck? Ask in Discord and say which of the above you have already checked. That
turns a long back-and-forth into one message.

---

## Welcome to Grim's Squad, Commander. o7

You are done. Have a look at the [Guides](/forum) board for what to do next.
`;

const COMPANION_APP = `
# The companion app — install and connect

The companion app is a small desktop program that runs alongside Elite Dangerous. It
watches the journal files the game already writes to your own computer and reports your
activity to the squadron, so credit for what you do is automatic rather than something
you remember to log.

You do not need it to be a member. It is what makes the activity and progression
tracking on this site work for you.

## What it does, plainly

- Reads the **journal files** Elite Dangerous writes locally as you play.
- Sends a summary of your activity to the squadron hub.
- Shows you what has been recorded.

## What it does not do

- It does not read your keystrokes, your other programs, or anything outside the game's
  own journal folder.
- It does not need your Frontier password. Ever.
- It does not play the game for you — nothing here touches the game process.

## 1. Download it

Get it from the downloads page on this website. Only download it from here.

> **⚠️ To the person maintaining this guide:** put the real download link and the
> current version number here once the release is published.

${shot('the downloads page showing the companion app and its version number')}

## 2. Install it

1. Run the installer you downloaded.
2. Windows may warn you about an unrecognised publisher. Choose **More info → Run
   anyway** if — and only if — you downloaded it from this site.
3. Follow the installer.

${shot('the installer window')}

${shot('the Windows SmartScreen warning, showing where "More info" is')}

## 3. Connect it to your account

1. Launch the app.
2. It will ask you to sign in. Choose to connect, and it will open your browser.
3. Sign in on this website and approve the connection.
4. Return to the app. It should now show your commander name.

${shot('the companion app on first launch, before sign-in')}

${shot('the browser approval screen')}

${shot('the app showing a connected commander name')}

> **Verify first.** Connecting works best once step 6 of the joining guide is done —
> without a verified commander the app has nothing to attribute your activity to.

## 4. Check it is working

1. Launch Elite Dangerous and play for a few minutes — a jump, a scan, anything.
2. Look at the app. It should show recent activity.
3. Your activity on this site updates from the same data.

${shot('the app showing recent detected activity')}

## Troubleshooting

**It says it cannot find my journal files.** The app looks where Elite Dangerous
writes them by default. If you have moved them, point the app at the folder in its
settings.

**It shows nothing after I played.** Confirm the app was running *while* you played —
it reads events as they are written, and it cannot see a session that happened while
it was closed.

**It says I am not verified.** Finish step 6 of the joining guide, then restart the
app.

**Something else.** Ask in Discord, and say what the app shows. A screenshot of its
status is usually enough to spot the problem.
`;

/**
 * The guide threads, in the order they should appear.
 *
 * Split into two threads rather than one: joining is a one-time sequence somebody
 * follows once, and the companion app is a thing they will come back to when it
 * misbehaves. Burying app troubleshooting at the bottom of a joining guide means
 * nobody finds it a month later.
 *
 * Each STEP is its own post inside the joining thread, so a member can be pointed at
 * "step 4" directly rather than at a wall of text with an instruction to scroll.
 */
export const GUIDE_THREADS: readonly GuideThread[] = [
  {
    slug: 'joining-grims-squad',
    title: "How to join Grim's Squad — complete step-by-step guide",
    isPublic: true,
    posts: [
      { bodyMd: OVERVIEW },
      { bodyMd: STEP_1 },
      { bodyMd: STEP_2 },
      { bodyMd: STEP_3 },
      { bodyMd: STEP_4 },
      { bodyMd: STEP_5 },
      { bodyMd: STEP_6 },
    ],
  },
  {
    slug: 'companion-app-install-and-connect',
    title: 'The companion app — install and connect',
    isPublic: true,
    posts: [{ bodyMd: COMPANION_APP }],
  },
];
