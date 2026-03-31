import {
  DocumentData,
  QuerySnapshot,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import {
  OrganizationAiAnswerMap,
  OrganizationDashboardData,
  OrganizationEventPreviewItem,
  OrganizationProfileData,
  OrganizationProfileUpdate,
  OrganizationStats,
} from '../types/organization';
import { EventItem, EventParticipationItem } from '../types/event';
import { FALLBACK_EVENT_IMAGE, mapFirestoreEvent, mapParticipationDoc } from './eventService';

const ORGANIZATION_PROFILE_COLLECTION = 'organizationProfiles';
const USERS_COLLECTION = 'users';
const EVENTS_COLLECTION = 'events';
const PARTICIPATIONS_COLLECTION = 'participations';

export const EMPTY_ORGANIZATION_STATS: OrganizationStats = {
  events: 0,
  active: 0,
  applications: 0,
  completed: 0,
};

class OrganizationProfileServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'OrganizationProfileServiceError';
    this.code = code;
  }
}

const getFirebaseErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;

const getReadableOrganizationProfileError = (error: unknown) => {
  const code = getFirebaseErrorCode(error);

  switch (code) {
    case 'permission-denied':
      return 'Нет доступа к профилю организации. Проверьте правила Firestore.';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Firestore временно недоступен. Попробуйте чуть позже.';
    case 'aborted':
    case 'failed-precondition':
      return 'Не удалось обработать профиль организации. Попробуйте ещё раз.';
    case 'auth/network-request-failed':
      return 'Проблема с сетью. Проверьте интернет и попробуйте снова.';
    default:
      return 'Не удалось загрузить или обновить профиль организации.';
  }
};

const toServiceError = (error: unknown) =>
  new OrganizationProfileServiceError(
    getReadableOrganizationProfileError(error),
    getFirebaseErrorCode(error),
  );

const trimText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeStringArray = (value: unknown) => {
  const items = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

const normalizeAnswerMap = (value: unknown): OrganizationAiAnswerMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<OrganizationAiAnswerMap>((accumulator, [key, item]) => {
    if (typeof item === 'string' && item.trim()) {
      accumulator[key] = item.trim();
    }

    return accumulator;
  }, {});
};

const deriveNameFromEmail = (email: string) => {
  const seed = email.split('@')[0]?.trim();

  if (!seed) {
    return 'Your organization';
  }

  return seed
    .split(/[._-]+/)
    .filter(Boolean)
    .map((chunk) => chunk[0]?.toUpperCase() + chunk.slice(1))
    .join(' ');
};

const toDateValue = (value: unknown) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const maybeToDate = (value as { toDate?: () => Date }).toDate;
    return typeof maybeToDate === 'function' ? maybeToDate.call(value) : null;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const RUSSIAN_MONTHS: Record<string, number> = {
  января: 0,
  февраль: 1,
  февраля: 1,
  март: 2,
  марта: 2,
  апрель: 3,
  апреля: 3,
  май: 4,
  мая: 4,
  июнь: 5,
  июня: 5,
  июль: 6,
  июля: 6,
  август: 7,
  августа: 7,
  сентябрь: 8,
  сентября: 8,
  октябрь: 9,
  октября: 9,
  ноябрь: 10,
  ноября: 10,
  декабрь: 11,
  декабря: 11,
};

const parseEventDate = (value: string) => {
  const raw = value.trim();

  if (!raw) {
    return null;
  }

  const directDate = new Date(raw);

  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const dottedMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);

  if (dottedMatch) {
    const [, day, month, year, hours = '12', minutes = '00'] = dottedMatch;
    const normalizedYear = year.length === 2 ? `20${year}` : year;
    const parsed = new Date(
      Number(normalizedYear),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
    );

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const localizedMatch = raw
    .toLowerCase()
    .match(/^(\d{1,2})\s+([а-яa-z]+)(?:\s+(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?$/i);

  if (!localizedMatch) {
    return null;
  }

  const [, dayValue, monthName, yearValue, hours = '12', minutes = '00'] = localizedMatch;
  const monthIndex = RUSSIAN_MONTHS[monthName];

  if (typeof monthIndex !== 'number') {
    return null;
  }

  const now = new Date();
  const resolvedYear = yearValue ? Number(yearValue) : now.getFullYear();
  let parsed = new Date(
    resolvedYear,
    monthIndex,
    Number(dayValue),
    Number(hours),
    Number(minutes),
  );

  if (!yearValue && parsed.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    parsed = new Date(
      resolvedYear + 1,
      monthIndex,
      Number(dayValue),
      Number(hours),
      Number(minutes),
    );
  }

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getOrganizationProfileRef = (uid: string) => doc(db, ORGANIZATION_PROFILE_COLLECTION, uid);
const getUserRef = (uid: string) => doc(db, USERS_COLLECTION, uid);

const sanitizeOrganizationProfile = (
  raw: Partial<OrganizationProfileData> | null | undefined,
  fallbackEmail: string,
  fallbackName: string,
): OrganizationProfileData => ({
  organizationName: trimText(raw?.organizationName) || fallbackName,
  contactPerson: trimText(raw?.contactPerson),
  email: trimText(raw?.email) || fallbackEmail,
  location: trimText(raw?.location),
  organizationType: trimText(raw?.organizationType),
  focusAreas: normalizeStringArray(raw?.focusAreas),
  description: trimText(raw?.description),
  avatarUrl: trimText(raw?.avatarUrl) || null,
  tagline: trimText(raw?.tagline),
  preferredVolunteerTraits: normalizeStringArray(raw?.preferredVolunteerTraits),
  commonTaskTypes: normalizeStringArray(raw?.commonTaskTypes),
  organizationContextSummary: trimText(raw?.organizationContextSummary),
  aiQuestionnaireAnswers: normalizeAnswerMap(raw?.aiQuestionnaireAnswers),
  createdAt: raw?.createdAt,
  updatedAt: raw?.updatedAt,
});

const buildMissingOrganizationProfileFields = (
  raw: Partial<OrganizationProfileData> | null | undefined,
  profile: OrganizationProfileData,
) => {
  const patch: Record<string, unknown> = {};

  if (!raw || !trimText(raw.organizationName)) {
    patch.organizationName = profile.organizationName;
  }
  if (!raw || !trimText(raw.contactPerson)) {
    patch.contactPerson = profile.contactPerson;
  }
  if (!raw || !trimText(raw.email)) {
    patch.email = profile.email;
  }
  if (!raw || !trimText(raw.location)) {
    patch.location = profile.location;
  }
  if (!raw || !trimText(raw.organizationType)) {
    patch.organizationType = profile.organizationType;
  }
  if (!raw || !Array.isArray(raw.focusAreas)) {
    patch.focusAreas = profile.focusAreas;
  }
  if (!raw || !trimText(raw.description)) {
    patch.description = profile.description;
  }
  if (!raw || (!trimText(raw.avatarUrl) && raw.avatarUrl !== null)) {
    patch.avatarUrl = profile.avatarUrl;
  }
  if (!raw || !trimText(raw.tagline)) {
    patch.tagline = profile.tagline;
  }
  if (!raw || !Array.isArray(raw.preferredVolunteerTraits)) {
    patch.preferredVolunteerTraits = profile.preferredVolunteerTraits;
  }
  if (!raw || !Array.isArray(raw.commonTaskTypes)) {
    patch.commonTaskTypes = profile.commonTaskTypes;
  }
  if (!raw || !trimText(raw.organizationContextSummary)) {
    patch.organizationContextSummary = profile.organizationContextSummary;
  }
  if (!raw || typeof raw.aiQuestionnaireAnswers !== 'object' || raw.aiQuestionnaireAnswers === null) {
    patch.aiQuestionnaireAnswers = profile.aiQuestionnaireAnswers;
  }
  if (!raw || raw.createdAt === undefined) {
    patch.createdAt = serverTimestamp();
  }

  return patch;
};

const syncUserShadowFields = async (uid: string, profile: OrganizationProfileData) => {
  await setDoc(
    getUserRef(uid),
    {
      displayName: profile.organizationName,
      ...(profile.email ? { email: profile.email } : {}),
      avatarUrl: profile.avatarUrl,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

const getEventStatus = (event: Pick<EventItem, 'date'>) => {
  const parsedDate = parseEventDate(event.date);

  if (!parsedDate) {
    return 'active' as const;
  }

  return parsedDate.getTime() >= Date.now() ? ('active' as const) : ('completed' as const);
};

const countEventApplications = (participations: EventParticipationItem[]) =>
  participations.filter(
    (item) =>
      item.status === 'joined' || item.status === 'accepted' || item.status === 'completed',
  ).length;

const compareEvents = (left: EventItem, right: EventItem) => {
  const leftCreatedAt = toDateValue(left.createdAt)?.getTime() ?? parseEventDate(left.date)?.getTime() ?? 0;
  const rightCreatedAt =
    toDateValue(right.createdAt)?.getTime() ?? parseEventDate(right.date)?.getTime() ?? 0;

  return rightCreatedAt - leftCreatedAt;
};

const buildDashboardData = (
  events: EventItem[],
  participations: EventParticipationItem[],
): OrganizationDashboardData => {
  const applicationsByEventId = new Map<string, number>();

  participations.forEach((item) => {
    if (item.status === 'removed' || item.status === 'cancelled') {
      return;
    }

    applicationsByEventId.set(item.eventId, (applicationsByEventId.get(item.eventId) ?? 0) + 1);
  });

  const sortedEvents = events.slice().sort(compareEvents);
  const activeEvents = events.filter((item) => getEventStatus(item) === 'active');
  const completedEvents = events.filter((item) => getEventStatus(item) === 'completed');

  const latestEvents: OrganizationEventPreviewItem[] = sortedEvents.slice(0, 5).map((item) => ({
    id: item.id,
    title: item.title,
    date: item.date,
    imageUrl: item.imageUrl || FALLBACK_EVENT_IMAGE,
    status: getEventStatus(item),
    applicationsCount: applicationsByEventId.get(item.id) ?? 0,
  }));

  return {
    stats: {
      events: events.length,
      active: activeEvents.length,
      applications: countEventApplications(participations),
      completed: completedEvents.length,
    },
    latestEvents,
  };
};

export async function createDefaultOrganizationProfileIfMissing(
  uid: string,
  email?: string,
): Promise<OrganizationProfileData> {
  try {
    const [userSnapshot, profileSnapshot] = await Promise.all([
      getDoc(getUserRef(uid)),
      getDoc(getOrganizationProfileRef(uid)),
    ]);

    const userData = userSnapshot.exists() ? userSnapshot.data() : {};
    const rawProfile = profileSnapshot.exists()
      ? (profileSnapshot.data() as Partial<OrganizationProfileData>)
      : null;
    const fallbackEmail = trimText(email) || trimText(userData.email);
    const fallbackName =
      trimText(rawProfile?.organizationName) ||
      trimText(userData.displayName) ||
      deriveNameFromEmail(fallbackEmail);
    const profile = sanitizeOrganizationProfile(rawProfile, fallbackEmail, fallbackName);
    const patch = buildMissingOrganizationProfileFields(rawProfile, profile);

    if (!profileSnapshot.exists() || Object.keys(patch).length > 0) {
      await setDoc(
        getOrganizationProfileRef(uid),
        {
          ...patch,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    await syncUserShadowFields(uid, profile);

    return profile;
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function getOrganizationProfile(uid: string): Promise<OrganizationProfileData> {
  return createDefaultOrganizationProfileIfMissing(uid);
}

export async function updateOrganizationProfile(
  uid: string,
  data: OrganizationProfileUpdate,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {};

    if (data.organizationName !== undefined) {
      patch.organizationName = trimText(data.organizationName);
    }
    if (data.contactPerson !== undefined) {
      patch.contactPerson = trimText(data.contactPerson);
    }
    if (data.email !== undefined) {
      patch.email = trimText(data.email);
    }
    if (data.location !== undefined) {
      patch.location = trimText(data.location);
    }
    if (data.organizationType !== undefined) {
      patch.organizationType = trimText(data.organizationType);
    }
    if (data.focusAreas !== undefined) {
      patch.focusAreas = normalizeStringArray(data.focusAreas);
    }
    if (data.description !== undefined) {
      patch.description = trimText(data.description);
    }
    if (data.avatarUrl !== undefined) {
      patch.avatarUrl = trimText(data.avatarUrl) || null;
    }
    if (data.tagline !== undefined) {
      patch.tagline = trimText(data.tagline);
    }
    if (data.preferredVolunteerTraits !== undefined) {
      patch.preferredVolunteerTraits = normalizeStringArray(data.preferredVolunteerTraits);
    }
    if (data.commonTaskTypes !== undefined) {
      patch.commonTaskTypes = normalizeStringArray(data.commonTaskTypes);
    }
    if (data.organizationContextSummary !== undefined) {
      patch.organizationContextSummary = trimText(data.organizationContextSummary);
    }
    if (data.aiQuestionnaireAnswers !== undefined) {
      patch.aiQuestionnaireAnswers = normalizeAnswerMap(data.aiQuestionnaireAnswers);
    }

    await setDoc(
      getOrganizationProfileRef(uid),
      {
        ...patch,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (
      data.organizationName !== undefined ||
      data.avatarUrl !== undefined ||
      data.email !== undefined
    ) {
      await setDoc(
        getUserRef(uid),
        {
          ...(data.organizationName !== undefined
            ? { displayName: trimText(data.organizationName) }
            : {}),
          ...(data.email !== undefined ? { email: trimText(data.email) } : {}),
          ...(data.avatarUrl !== undefined
            ? { avatarUrl: trimText(data.avatarUrl) || null }
            : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    // TODO: generate a structured organization summary for future AI tools.
    // TODO: recommend volunteer traits based on live organization profile data.
  } catch (error) {
    throw toServiceError(error);
  }
}

export function subscribeToOrganizationProfile(
  uid: string,
  email: string | undefined,
  callback: (profile: OrganizationProfileData) => void,
  onError?: (message: string) => void,
) {
  return onSnapshot(
    getOrganizationProfileRef(uid),
    async (snapshot) => {
      try {
        const userSnapshot = await getDoc(getUserRef(uid));
        const userData = userSnapshot.exists() ? userSnapshot.data() : {};

        if (!snapshot.exists()) {
          const createdProfile = await createDefaultOrganizationProfileIfMissing(
            uid,
            email || trimText(userData.email),
          );
          callback(createdProfile);
          return;
        }

        const rawProfile = snapshot.data() as Partial<OrganizationProfileData>;
        const fallbackEmail = trimText(rawProfile.email) || trimText(email) || trimText(userData.email);
        const fallbackName =
          trimText(rawProfile.organizationName) ||
          trimText(userData.displayName) ||
          deriveNameFromEmail(fallbackEmail);
        const profile = sanitizeOrganizationProfile(rawProfile, fallbackEmail, fallbackName);
        const patch = buildMissingOrganizationProfileFields(rawProfile, profile);

        callback(profile);

        if (Object.keys(patch).length > 0) {
          await setDoc(
            getOrganizationProfileRef(uid),
            {
              ...patch,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }

        await syncUserShadowFields(uid, profile);
      } catch (error) {
        onError?.(getReadableOrganizationProfileError(error));
      }
    },
    (error) => {
      onError?.(getReadableOrganizationProfileError(error));
    },
  );
}

export function subscribeToOrganizationDashboard(
  uid: string,
  callback: (dashboard: OrganizationDashboardData) => void,
  onError?: (message: string) => void,
) {
  const eventsQuery = query(collection(db, EVENTS_COLLECTION), where('createdBy', '==', uid));
  const participationsQuery = query(
    collection(db, PARTICIPATIONS_COLLECTION),
    where('organizationId', '==', uid),
  );

  let latestEvents: EventItem[] = [];
  let latestParticipations: EventParticipationItem[] = [];

  const emit = () => {
    callback(buildDashboardData(latestEvents, latestParticipations));
  };

  const unsubscribeEvents = onSnapshot(
    eventsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      latestEvents = snapshot.docs.map(mapFirestoreEvent);
      emit();
    },
    (error) => {
      onError?.(getReadableOrganizationProfileError(error));
    },
  );

  const unsubscribeParticipations = onSnapshot(
    participationsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      latestParticipations = snapshot.docs.map(mapParticipationDoc);
      emit();
    },
    (error) => {
      onError?.(getReadableOrganizationProfileError(error));
    },
  );

  return () => {
    unsubscribeEvents();
    unsubscribeParticipations();
  };
}

export { OrganizationProfileServiceError };
