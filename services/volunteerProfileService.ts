import { User } from 'firebase/auth';
import {
  DocumentData,
  QuerySnapshot,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '../lib/firebase';
import {
  GratitudeRecord,
  ParticipationRecord,
  ParticipationStatus,
  VolunteerActivityItem,
  VolunteerProfileData,
  VolunteerProfileInsights,
  VolunteerProfileUpdate,
  VolunteerStats,
} from '../types/profile';

const VOLUNTEER_PROFILE_COLLECTION = 'volunteerProfiles';
const USERS_COLLECTION = 'users';
const PARTICIPATIONS_COLLECTION = 'participations';
const GRATITUDE_COLLECTION = 'gratitude';

export const EMPTY_VOLUNTEER_STATS: VolunteerStats = {
  eventsJoined: 0,
  volunteerHours: 0,
  thanksCount: 0,
  completedTasks: 0,
  completionRate: null,
  monthlyImpactCount: 0,
};

class VolunteerProfileServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'VolunteerProfileServiceError';
    this.code = code;
  }
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const getFirebaseErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;

const getReadableProfileError = (error: unknown) => {
  const code = getFirebaseErrorCode(error);

  switch (code) {
    case 'storage/unauthorized':
    case 'permission-denied':
      return 'Не хватает прав для обновления профиля. Проверьте правила Firebase.';
    case 'storage/canceled':
      return 'Загрузка фото была отменена.';
    case 'storage/unknown':
    case 'storage/retry-limit-exceeded':
    case 'unavailable':
      return 'Не удалось обновить профиль. Попробуйте ещё раз чуть позже.';
    case 'storage/object-not-found':
      return 'Файл изображения не найден.';
    case 'storage/quota-exceeded':
      return 'Превышена квота хранилища Firebase.';
    case 'storage/invalid-format':
    case 'storage/invalid-checksum':
      return 'Не удалось обработать изображение. Выберите другое фото.';
    case 'auth/network-request-failed':
      return 'Проблема с сетью. Проверьте интернет и попробуйте снова.';
    default:
      return 'Не удалось обновить профиль. Попробуйте ещё раз.';
  }
};

const toServiceError = (error: unknown) =>
  new VolunteerProfileServiceError(getReadableProfileError(error), getFirebaseErrorCode(error));

const trimText = (value: unknown) => (isString(value) ? value.trim() : '');

const normalizeOptionalHandle = (value: string) => {
  const trimmed = value.trim().replace(/\s+/g, '_');
  if (!trimmed) {
    return '';
  }

  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
};

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(isString).map((item) => item.trim()).filter(Boolean)
    : [];

const normalizeNumberArray = (value: unknown) =>
  Array.isArray(value) ? value.filter(isNumber) : [];

const deriveFallbackName = (user: User) =>
  trimText(user.displayName) || trimText(user.email?.split('@')[0]) || 'Volunteer';

const deriveHandleFromSeed = (seed: string) => {
  const normalized = seed
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/gi, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '');

  return `@${normalized || 'volunet.user'}`;
};

const deriveFallbackHandle = (user: User, fullName: string) =>
  deriveHandleFromSeed(fullName || user.email?.split('@')[0] || user.uid.slice(0, 8));

const sanitizeVolunteerProfile = (user: User, raw?: Partial<VolunteerProfileData> | null): VolunteerProfileData => {
  const fullName = trimText(raw?.fullName) || deriveFallbackName(user);

  return {
    fullName,
    handle: normalizeOptionalHandle(trimText(raw?.handle)) || deriveFallbackHandle(user, fullName),
    city: trimText(raw?.city),
    bio: trimText(raw?.bio),
    aiAbout: trimText(raw?.aiAbout),
    avatarUrl: trimText(raw?.avatarUrl) || null,
    skills: normalizeStringArray(raw?.skills),
    interests: normalizeStringArray(raw?.interests),
    causes: normalizeStringArray(raw?.causes),
    availability: normalizeStringArray(raw?.availability),
    embedding: normalizeNumberArray(raw?.embedding),
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
  };
};

const buildMissingVolunteerProfileFields = (
  user: User,
  raw?: Partial<VolunteerProfileData> | null,
): Record<string, unknown> => {
  const next = sanitizeVolunteerProfile(user, raw);
  const patch: Record<string, unknown> = {};

  if (!raw || !trimText(raw.fullName)) {
    patch.fullName = next.fullName;
  }
  if (!raw || !trimText(raw.handle)) {
    patch.handle = next.handle;
  }
  if (!raw || !isString(raw.city)) {
    patch.city = next.city;
  }
  if (!raw || !isString(raw.bio)) {
    patch.bio = next.bio;
  }
  if (!raw || !isString(raw.aiAbout)) {
    patch.aiAbout = next.aiAbout;
  }
  if (!raw || (!isString(raw.avatarUrl) && raw.avatarUrl !== null)) {
    patch.avatarUrl = next.avatarUrl;
  }
  if (!raw || !Array.isArray(raw.skills)) {
    patch.skills = next.skills;
  }
  if (!raw || !Array.isArray(raw.interests)) {
    patch.interests = next.interests;
  }
  if (!raw || !Array.isArray(raw.causes)) {
    patch.causes = next.causes;
  }
  if (!raw || !Array.isArray(raw.availability)) {
    patch.availability = next.availability;
  }
  if (!raw || !Array.isArray(raw.embedding)) {
    patch.embedding = next.embedding;
  }
  if (!raw || raw.createdAt === undefined) {
    patch.createdAt = serverTimestamp();
  }

  return patch;
};

const syncUserShadowFields = async (userId: string, profile: VolunteerProfileData) => {
  await setDoc(
    doc(db, USERS_COLLECTION, userId),
    {
      displayName: profile.fullName,
      username: profile.handle,
      avatarUrl: profile.avatarUrl,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

const getVolunteerProfileRef = (userId: string) => doc(db, VOLUNTEER_PROFILE_COLLECTION, userId);

const toDate = (value: unknown) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const maybeDate = (value as { toDate?: () => Date }).toDate;
    return typeof maybeDate === 'function' ? maybeDate.call(value) : null;
  }

  return null;
};

const mapParticipationSnapshot = (snapshot: QuerySnapshot<DocumentData>): ParticipationRecord[] =>
  snapshot.docs.map((item) => {
    const data = item.data();
    const rawStatus = trimText(data.status) as ParticipationStatus;

    return {
      id: item.id,
      userId: trimText(data.userId),
      eventId: trimText(data.eventId),
      status: rawStatus || 'joined',
      hours: isNumber(data.hours) ? data.hours : 0,
      createdAt: data.createdAt,
      completedAt: data.completedAt,
      eventTitle: trimText(data.eventTitle),
    };
  });

const mapGratitudeSnapshot = (snapshot: QuerySnapshot<DocumentData>): GratitudeRecord[] =>
  snapshot.docs.map((item) => {
    const data = item.data();

    return {
      id: item.id,
      toUserId: trimText(data.toUserId),
      fromOrganizationId: trimText(data.fromOrganizationId) || undefined,
      eventId: trimText(data.eventId) || undefined,
      message: trimText(data.message) || undefined,
      createdAt: data.createdAt,
    };
  });

const isJoinedStatus = (status: ParticipationStatus) =>
  status === 'joined' || status === 'accepted' || status === 'completed';

const isCompletedStatus = (status: ParticipationStatus) => status === 'completed';

const isSameMonth = (date: Date, now: Date) =>
  date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();

const pluralize = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }

  return many;
};

export const calculateProfileCompletion = (profile: VolunteerProfileData) => {
  const checkpoints = [
    Boolean(profile.fullName.trim()),
    Boolean(profile.handle.trim()),
    Boolean(profile.bio.trim()),
    Boolean(profile.aiAbout.trim()),
    Boolean(profile.city.trim()),
    Boolean(profile.avatarUrl),
    profile.skills.length > 0,
    profile.interests.length > 0,
  ];

  const completed = checkpoints.filter(Boolean).length;
  return Math.round((completed / checkpoints.length) * 100);
};

export const getVolunteerStatsFromRecords = (
  participations: ParticipationRecord[],
  gratitude: GratitudeRecord[],
): VolunteerStats => {
  const joinedRecords = participations.filter((item) => isJoinedStatus(item.status));
  const completedRecords = participations.filter((item) => isCompletedStatus(item.status));
  const now = new Date();

  return {
    eventsJoined: joinedRecords.length,
    volunteerHours: completedRecords.reduce((sum, item) => sum + Math.max(0, item.hours), 0),
    thanksCount: gratitude.length,
    completedTasks: completedRecords.length,
    completionRate: joinedRecords.length > 0 ? Math.round((completedRecords.length / joinedRecords.length) * 100) : null,
    monthlyImpactCount: completedRecords.filter((item) => {
      const completedAt = toDate(item.completedAt) ?? toDate(item.createdAt);
      return completedAt ? isSameMonth(completedAt, now) : false;
    }).length,
  };
};

export const buildVolunteerProfileInsights = (
  profile: VolunteerProfileData,
  stats: VolunteerStats,
  participations: ParticipationRecord[],
  gratitude: GratitudeRecord[],
): VolunteerProfileInsights => {
  const activityItems: VolunteerActivityItem[] = [];

  if (stats.monthlyImpactCount > 0) {
    activityItems.push({
      id: 'monthly-impact',
      title: `В этом месяце вы завершили ${stats.monthlyImpactCount} ${pluralize(
        stats.monthlyImpactCount,
        'волонтёрскую задачу',
        'волонтёрские задачи',
        'волонтёрских задач',
      )}.`,
      subtitle: 'Регулярная активность помогает AI точнее находить подходящие события и роли.',
    });
  }

  if (stats.thanksCount > 0) {
    activityItems.push({
      id: 'thanks',
      title: `Вы получили ${stats.thanksCount} ${pluralize(stats.thanksCount, 'благодарность', 'благодарности', 'благодарностей')}.`,
      subtitle: 'Положительная обратная связь усиливает доверие к вашему профилю у организаций.',
    });
  }

  if (profile.skills.length > 0) {
    activityItems.push({
      id: 'skills',
      title: `Навыки в профиле: ${profile.skills.slice(0, 3).join(', ')}${profile.skills.length > 3 ? ' и другие' : ''}.`,
      subtitle: 'Чем точнее навыки, тем сильнее будущий AI-мэтчинг событий и задач.',
    });
  }

  if (profile.interests.length > 0) {
    activityItems.push({
      id: 'interests',
      title: `Интересы уже помогают с тематическим подбором: ${profile.interests.slice(0, 2).join(', ')}${profile.interests.length > 2 ? '...' : ''}`,
      subtitle: 'Выделенные темы подскажут, какие возможности показывать вам в первую очередь.',
    });
  }

  if (activityItems.length === 0) {
    activityItems.push({
      id: 'empty-profile',
      title: 'Профиль пока только начинает собирать историю.',
      subtitle: 'Добавьте описание, навыки и интересы, чтобы AI и организации видели ваш стиль помощи.',
    });
  }

  const recentParticipation = participations
    .slice()
    .sort((left, right) => {
      const leftDate = toDate(left.completedAt) ?? toDate(left.createdAt);
      const rightDate = toDate(right.completedAt) ?? toDate(right.createdAt);
      return (rightDate?.getTime() ?? 0) - (leftDate?.getTime() ?? 0);
    })
    .find((item) => Boolean(item.eventTitle));

  const impactHeadline =
    stats.completedTasks > 0
      ? `Завершено ${stats.completedTasks} ${pluralize(stats.completedTasks, 'задача', 'задачи', 'задач')} и ${stats.eventsJoined} ${pluralize(stats.eventsJoined, 'событие', 'события', 'событий')} в профиле.`
      : 'Профиль готов к первым откликам и реальной волонтёрской истории.';

  const impactBody = recentParticipation?.eventTitle
    ? `Последняя заметная активность связана с событием «${recentParticipation.eventTitle}». Чем больше завершённых участий и отзывов, тем сильнее профиль доверия.`
    : profile.aiAbout.trim()
      ? 'AI уже может использовать ваше описание, чтобы точнее рекомендовать форматы помощи и подходящие события.'
      : 'Расскажите о себе чуть подробнее, чтобы рекомендации и будущий мэтчинг стали персональнее.';

  const reliabilityLabel =
    stats.completionRate === null
      ? 'Надёжность появится после первых участий'
      : `Надёжность ${stats.completionRate}% по завершённым откликам`;

  if (gratitude.length > 0 && activityItems.length < 4) {
    const gratitudeItem = gratitude[0];
    activityItems.push({
      id: 'gratitude-note',
      title: 'В профиле есть живая благодарность от организации.',
      subtitle: gratitudeItem.message || 'Такие сигналы усиливают доверие и влияют на будущие рекомендации.',
    });
  }

  return {
    impactHeadline,
    impactBody,
    reliabilityLabel,
    activityItems: activityItems.slice(0, 4),
  };
};

export async function ensureVolunteerProfile(user: User): Promise<VolunteerProfileData> {
  try {
    const profileRef = getVolunteerProfileRef(user.uid);
    const snapshot = await getDoc(profileRef);
    const raw = snapshot.exists() ? (snapshot.data() as Partial<VolunteerProfileData>) : null;
    const profile = sanitizeVolunteerProfile(user, raw);
    const patch = buildMissingVolunteerProfileFields(user, raw);

    if (!snapshot.exists() || Object.keys(patch).length > 0) {
      await setDoc(
        profileRef,
        {
          ...patch,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    await syncUserShadowFields(user.uid, profile);

    return profile;
  } catch (error) {
    throw toServiceError(error);
  }
}

export function subscribeToVolunteerProfile(
  user: User,
  callback: (profile: VolunteerProfileData) => void,
  onError?: (message: string) => void,
) {
  const profileRef = getVolunteerProfileRef(user.uid);

  return onSnapshot(
    profileRef,
    async (snapshot) => {
      try {
        if (!snapshot.exists()) {
          const createdProfile = await ensureVolunteerProfile(user);
          callback(createdProfile);
          return;
        }

        const raw = snapshot.data() as Partial<VolunteerProfileData>;
        const profile = sanitizeVolunteerProfile(user, raw);
        callback(profile);

        const patch = buildMissingVolunteerProfileFields(user, raw);
        if (Object.keys(patch).length > 0) {
          await setDoc(
            profileRef,
            {
              ...patch,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }

        await syncUserShadowFields(user.uid, profile);
      } catch (error) {
        onError?.(getReadableProfileError(error));
      }
    },
    (error) => {
      onError?.(getReadableProfileError(error));
    },
  );
}

export function subscribeToVolunteerStats(
  userId: string,
  callback: (
    stats: VolunteerStats,
    insights: VolunteerProfileInsights,
    participations: ParticipationRecord[],
    gratitude: GratitudeRecord[],
  ) => void,
  getProfile: () => VolunteerProfileData | null,
  onError?: (message: string) => void,
) {
  const participationsQuery = query(
    collection(db, PARTICIPATIONS_COLLECTION),
    where('userId', '==', userId),
  );
  const gratitudeQuery = query(collection(db, GRATITUDE_COLLECTION), where('toUserId', '==', userId));

  let latestParticipations: ParticipationRecord[] = [];
  let latestGratitude: GratitudeRecord[] = [];

  const emit = () => {
    const profile = getProfile();

    if (!profile) {
      return;
    }

    const stats = getVolunteerStatsFromRecords(latestParticipations, latestGratitude);
    const insights = buildVolunteerProfileInsights(profile, stats, latestParticipations, latestGratitude);
    callback(stats, insights, latestParticipations, latestGratitude);
  };

  const unsubscribeParticipations = onSnapshot(
    participationsQuery,
    (snapshot) => {
      latestParticipations = mapParticipationSnapshot(snapshot);
      emit();
    },
    (error) => {
      onError?.(getReadableProfileError(error));
    },
  );

  const unsubscribeGratitude = onSnapshot(
    gratitudeQuery,
    (snapshot) => {
      latestGratitude = mapGratitudeSnapshot(snapshot);
      emit();
    },
    (error) => {
      onError?.(getReadableProfileError(error));
    },
  );

  return () => {
    unsubscribeParticipations();
    unsubscribeGratitude();
  };
}

export async function updateVolunteerProfile(userId: string, patch: VolunteerProfileUpdate) {
  try {
    const nextPatch: Record<string, unknown> = {};

    if (patch.fullName !== undefined) {
      nextPatch.fullName = trimText(patch.fullName);
    }
    if (patch.handle !== undefined) {
      nextPatch.handle = normalizeOptionalHandle(patch.handle);
    }
    if (patch.city !== undefined) {
      nextPatch.city = trimText(patch.city);
    }
    if (patch.bio !== undefined) {
      nextPatch.bio = trimText(patch.bio);
    }
    if (patch.aiAbout !== undefined) {
      nextPatch.aiAbout = trimText(patch.aiAbout);
    }
    if (patch.avatarUrl !== undefined) {
      nextPatch.avatarUrl = trimText(patch.avatarUrl) || null;
    }
    if (patch.skills !== undefined) {
      nextPatch.skills = normalizeStringArray(patch.skills);
    }
    if (patch.interests !== undefined) {
      nextPatch.interests = normalizeStringArray(patch.interests);
    }

    await setDoc(
      getVolunteerProfileRef(userId),
      {
        ...nextPatch,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (patch.fullName !== undefined || patch.handle !== undefined || patch.avatarUrl !== undefined) {
      await setDoc(
        doc(db, USERS_COLLECTION, userId),
        {
          ...(patch.fullName !== undefined ? { displayName: trimText(patch.fullName) } : {}),
          ...(patch.handle !== undefined ? { username: normalizeOptionalHandle(patch.handle) } : {}),
          ...(patch.avatarUrl !== undefined ? { avatarUrl: trimText(patch.avatarUrl) || null } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    // TODO: generate or refresh volunteer embeddings when core profile fields change.
    // TODO: trigger semantic matching refresh for volunteer recommendations.
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function addVolunteerSkill(userId: string, skill: string) {
  const normalizedSkill = trimText(skill);

  if (!normalizedSkill) {
    return;
  }

  try {
    await updateDoc(getVolunteerProfileRef(userId), {
      skills: arrayUnion(normalizedSkill),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function removeVolunteerSkill(userId: string, skill: string) {
  try {
    await updateDoc(getVolunteerProfileRef(userId), {
      skills: arrayRemove(skill),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function addVolunteerInterest(userId: string, interest: string) {
  const normalizedInterest = trimText(interest);

  if (!normalizedInterest) {
    return;
  }

  try {
    await updateDoc(getVolunteerProfileRef(userId), {
      interests: arrayUnion(normalizedInterest),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function removeVolunteerInterest(userId: string, interest: string) {
  try {
    await updateDoc(getVolunteerProfileRef(userId), {
      interests: arrayRemove(interest),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    throw toServiceError(error);
  }
}

const localUriToBlob = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      resolve(xhr.response as Blob);
    };
    xhr.onerror = () => {
      reject(new Error('Не удалось подготовить изображение к загрузке.'));
    };
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });

export async function uploadVolunteerAvatar(userId: string, localUri: string) {
  let blob: Blob | null = null;

  try {
    const extensionMatch = localUri.match(/\.(\w+)(?:\?|$)/);
    const extension = extensionMatch?.[1]?.toLowerCase() || 'jpg';
    const avatarRef = ref(storage, `avatars/${userId}/profile-${Date.now()}.${extension}`);

    blob = await localUriToBlob(localUri);

    await uploadBytes(avatarRef, blob, {
      contentType: extension === 'png' ? 'image/png' : 'image/jpeg',
    });

    const downloadUrl = await getDownloadURL(avatarRef);

    await updateVolunteerProfile(userId, { avatarUrl: downloadUrl });

    // TODO: optionally remove the previous avatar file from Firebase Storage after a successful swap.
    return downloadUrl;
  } catch (error) {
    throw toServiceError(error);
  } finally {
    (blob as { close?: () => void } | null)?.close?.();
  }
}

export { VolunteerProfileServiceError };
