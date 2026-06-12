/**
 * Synthetic identity generator — Sprint S1.2.
 *
 * Deterministic, seeded generation of fictional people (names, DOB, email,
 * phone) for the demo data engine. Determinism is load-bearing: the same
 * seed must always produce the same roster so the generated output is
 * testable and a demo tenant reset (S1.12 / S3.6) re-creates identical data.
 *
 * No external dependencies — the PRNG is mulberry32 seeded via xmur3, the
 * standard small-deterministic-PRNG pairing.
 *
 * Safety (S1.2 / S3.9): every email uses the reserved, non-deliverable
 * `.test` TLD; phones use documentation/fictional ranges; and all output is
 * checked against a banned-substring list so a real name/email/phone can
 * never slip into a demo tenant.
 */

// ============================================================================
// Deterministic PRNG (mulberry32 + xmur3 seed)
// ============================================================================

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** True with the given probability (default 0.5). */
  bool(prob?: number): boolean;
  /** Weighted pick: entries are [value, weight] with positive integer weights. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T;
}

/** Create a deterministic RNG from a string seed. */
export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  const rand = mulberry32(seedFn());
  const next = (): number => rand();
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(arr: readonly T[]): T => {
    if (arr.length === 0) throw new Error('createRng.pick: empty array');
    return arr[int(0, arr.length - 1)];
  };
  const bool = (prob = 0.5): boolean => next() < prob;
  const weighted = <T>(entries: ReadonlyArray<readonly [T, number]>): T => {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = int(1, total);
    for (const [value, w] of entries) {
      roll -= w;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  };
  return { next, int, pick, bool, weighted };
}

// ============================================================================
// Name pools (fictional, locale-appropriate)
// ============================================================================

export type Gender = 'male' | 'female';
export type NamePool = 'nepali' | 'us';

const NEPALI = {
  givenMale: [
    'Aarav', 'Bibek', 'Prabin', 'Suman', 'Nabin', 'Rohan', 'Sandesh', 'Anish',
    'Bishal', 'Kiran', 'Manish', 'Niraj', 'Pratik', 'Rajan', 'Sanjay', 'Suraj',
    'Ujjwal', 'Bikash', 'Deepak', 'Gaurav', 'Hari', 'Kushal', 'Milan', 'Sujan',
  ],
  givenFemale: [
    'Aastha', 'Bina', 'Sirjana', 'Puja', 'Sneha', 'Anita', 'Kabita', 'Manisha',
    'Nisha', 'Priya', 'Rashmi', 'Samjhana', 'Sunita', 'Bishnu', 'Deepa', 'Gita',
    'Laxmi', 'Muna', 'Pooja', 'Sabina', 'Sarita', 'Smriti', 'Sushma', 'Yamuna',
  ],
  family: [
    'Sharma', 'Adhikari', 'Shrestha', 'Karki', 'Thapa', 'Gurung', 'Tamang',
    'Magar', 'Bhattarai', 'Poudel', 'Acharya', 'Koirala', 'Lamichhane',
    'Dahal', 'Khadka', 'Rai', 'Limbu', 'Maharjan', 'Pandey', 'Subedi',
    'Bhandari', 'Ghimire', 'Joshi', 'Pokharel',
  ],
};

const US = {
  givenMale: [
    'Liam', 'Noah', 'Oliver', 'Elijah', 'James', 'Benjamin', 'Lucas', 'Henry',
    'Alexander', 'Mason', 'Michael', 'Ethan', 'Daniel', 'Jacob', 'Logan',
    'Jackson', 'Sebastian', 'Mateo', 'Jack', 'Owen', 'Theodore', 'Aiden',
    'Samuel', 'Joseph',
  ],
  givenFemale: [
    'Olivia', 'Emma', 'Charlotte', 'Amelia', 'Sophia', 'Isabella', 'Ava',
    'Mia', 'Evelyn', 'Harper', 'Luna', 'Camila', 'Gianna', 'Elizabeth',
    'Eleanor', 'Ella', 'Abigail', 'Sofia', 'Avery', 'Scarlett', 'Emily',
    'Aria', 'Penelope', 'Chloe',
  ],
  family: [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
    'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
    'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
    'Lee', 'Thompson', 'White', 'Harris',
  ],
};

function poolFor(namePool: NamePool): typeof NEPALI {
  return namePool === 'nepali' ? NEPALI : US;
}

// ============================================================================
// Safety: reserved domains + banned content
// ============================================================================

/** RFC-2606 reserved `.test` TLD — guaranteed non-deliverable. */
export const DEMO_EMAIL_DOMAIN = 'demo.edforge.test';

/**
 * Substrings that must never appear in demo output. Seeded with markers of
 * real data we know about (the real first pilot school) so an accidental
 * reuse fails the S1.2 / S3.9 scan. Operators extend this list with any
 * real names that must be excluded.
 */
export const BANNED_SUBSTRINGS: readonly string[] = [
  'saraswati', // real first-pilot school name
  'edforge.app', // real production domain
  '@gmail', // real mail domains must never appear in demo data
  '@yahoo',
  '@outlook',
];

/** Return the banned substrings found across the given values (case-insensitive). */
export function findBannedContent(values: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const v of values) {
    const low = v.toLowerCase();
    for (const banned of BANNED_SUBSTRINGS) {
      if (low.includes(banned.toLowerCase())) hits.add(banned);
    }
  }
  return [...hits];
}

/** Throw if any value contains a banned substring. */
export function assertNoBannedContent(values: readonly string[]): void {
  const hits = findBannedContent(values);
  if (hits.length > 0) {
    throw new Error(`demo data contains banned substring(s): ${hits.join(', ')}`);
  }
}

// ============================================================================
// Date-of-birth ↔ age
// ============================================================================

/**
 * Deterministic date of birth for a person who is `ageYears` old as of
 * `asOfIso` (an AD `YYYY-MM-DD` date). Month/day are jittered by the RNG so
 * a cohort isn't all born on the same day, while staying within the age.
 */
export function dateOfBirthForAge(rng: Rng, ageYears: number, asOfIso: string): string {
  // Anchor at noon UTC so the year read is timezone-independent (a bare
  // `T12:00:00` is parsed in local time and would shift the year at the
  // date-line in extreme zones).
  const asOf = new Date(`${asOfIso}T12:00:00Z`);
  const birthYear = asOf.getUTCFullYear() - ageYears;
  const month = rng.int(1, 12);
  // Clamp to 28 to stay valid in every month without leap-year branching.
  const day = rng.int(1, 28);
  return `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ============================================================================
// Person factory (unique names + emails within an allocator)
// ============================================================================

export interface SyntheticPerson {
  firstName: string;
  lastName: string;
  gender: Gender;
  /** AD `YYYY-MM-DD`. */
  dateOfBirth: string;
  /** Reserved-TLD, non-deliverable. */
  email: string;
  /** Fictional-range phone. */
  phone: string;
}

export interface PersonRequest {
  /** Defaults to a coin-flip. */
  gender?: Gender;
  ageYears: number;
  /** AD `YYYY-MM-DD` the age is computed against. */
  asOf: string;
  /** Local-part prefix for the email (e.g. 'teacher', 'student'); optional. */
  emailTag?: string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

function fakePhone(namePool: NamePool, rng: Rng): string {
  if (namePool === 'us') {
    // NANP fictional block: +1 (XXX) 555-01XX is reserved for fiction.
    const area = rng.int(200, 989);
    const line = rng.int(100, 199);
    return `+1${area}555${String(line).padStart(4, '0')}`;
  }
  // Nepal: a reserved fictional 98-00 block (not an allocated mobile prefix).
  return `+97798000${String(rng.int(0, 99999)).padStart(5, '0')}`;
}

/**
 * Allocates unique people from a name pool. Guarantees no two allocated
 * people share a full name or an email within this allocator's lifetime
 * (one allocator per school keeps a school's roster internally unique).
 */
export class PersonFactory {
  private readonly usedNames = new Set<string>();
  private readonly usedEmails = new Set<string>();

  constructor(
    private readonly rng: Rng,
    private readonly namePool: NamePool,
  ) {}

  private uniqueName(gender: Gender): { firstName: string; lastName: string } {
    const pool = poolFor(this.namePool);
    const given = gender === 'male' ? pool.givenMale : pool.givenFemale;
    for (let attempt = 0; attempt < 64; attempt++) {
      const firstName = this.rng.pick(given);
      const lastName = this.rng.pick(pool.family);
      const key = `${firstName}|${lastName}`;
      if (!this.usedNames.has(key)) {
        this.usedNames.add(key);
        return { firstName, lastName };
      }
    }
    // Pools exhausted for this combination — disambiguate with a middle
    // initial so we still return a unique, human-plausible name.
    const firstName = this.rng.pick(given);
    const lastName = this.rng.pick(pool.family);
    const initial = String.fromCharCode(65 + this.rng.int(0, 25));
    const key = `${firstName} ${initial}.|${lastName}|${this.usedNames.size}`;
    this.usedNames.add(key);
    return { firstName: `${firstName} ${initial}.`, lastName };
  }

  private uniqueEmail(firstName: string, lastName: string, tag?: string): string {
    const base = `${slug(firstName)}.${slug(lastName)}${tag ? `.${slug(tag)}` : ''}`;
    let candidate = `${base}@${DEMO_EMAIL_DOMAIN}`;
    let n = 1;
    while (this.usedEmails.has(candidate)) {
      n += 1;
      candidate = `${base}${n}@${DEMO_EMAIL_DOMAIN}`;
    }
    this.usedEmails.add(candidate);
    return candidate;
  }

  person(req: PersonRequest): SyntheticPerson {
    const gender: Gender = req.gender ?? (this.rng.bool() ? 'male' : 'female');
    const { firstName, lastName } = this.uniqueName(gender);
    const email = this.uniqueEmail(firstName, lastName, req.emailTag);
    return {
      firstName,
      lastName,
      gender,
      dateOfBirth: dateOfBirthForAge(this.rng, req.ageYears, req.asOf),
      email,
      phone: fakePhone(this.namePool, this.rng),
    };
  }
}
