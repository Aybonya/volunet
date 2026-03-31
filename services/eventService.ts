import { User } from 'firebase/auth';
import {
  DocumentData,
  QueryDocumentSnapshot,
  QuerySnapshot,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { VolunteerProfileData } from '../types/profile';
import {
  CreateEventAnnouncementInput,
  CreateEventInput,
  EventAnnouncementItem,
  EventItem,
  EventParticipationItem,
  OrganizationNotificationItem,
  RegisteredVolunteerCard,
  VolunteerNotificationItem,
} from '../types/event';

const FALLBACK_EVENT_IMAGE =
  'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=1200&q=80';

class EventServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'EventServiceError';
    this.code = code;
  }
}

const PARTICIPATIONS_COLLECTION = 'participations';
const EVENT_ANNOUNCEMENTS_COLLECTION = 'eventAnnouncements';
const VOLUNTEER_NOTIFICATIONS_COLLECTION = 'volunteerNotifications';
const ORGANIZATION_NOTIFICATIONS_COLLECTION = 'organizationNotifications';
const USER_SAVED_EVENTS_SUBCOLLECTION = 'savedEvents';

const getEventErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;

const getReadableEventError = (error: unknown) => {
  const code = getEventErrorCode(error);

  switch (code) {
    case 'permission-denied':
      return 'Нет доступа к сохранению или загрузке событий.';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Сервис Firestore временно недоступен. Попробуйте чуть позже.';
    case 'aborted':
    case 'failed-precondition':
      return 'Не удалось обработать событие. Попробуйте ещё раз.';
    case 'network-request-failed':
      return 'Ошибка сети. Проверьте интернет и попробуйте снова.';
    default:
      return 'Не удалось выполнить операцию с событиями. Попробуйте ещё раз.';
  }
};

const toEventServiceError = (error: unknown) =>
  new EventServiceError(getReadableEventError(error), getEventErrorCode(error));

const trimText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const toDateValue = (value: unknown) => {
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

const isActiveParticipationStatus = (status: EventParticipationItem['status']) =>
  status === 'joined' || status === 'accepted' || status === 'completed';

export const mapParticipationDoc = (
  docSnapshot: QueryDocumentSnapshot<DocumentData>,
): EventParticipationItem => {
  const data = docSnapshot.data();
  const rawStatus = trimText(data.status) as EventParticipationItem['status'];

  return {
    id: docSnapshot.id,
    eventId: trimText(data.eventId),
    eventTitle: trimText(data.eventTitle),
    organizationId: trimText(data.organizationId),
    userId: trimText(data.userId),
    status: rawStatus || 'joined',
    hours: typeof data.hours === 'number' && Number.isFinite(data.hours) ? data.hours : 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

export const mapAnnouncementDoc = (
  docSnapshot: QueryDocumentSnapshot<DocumentData>,
): EventAnnouncementItem => {
  const data = docSnapshot.data();

  return {
    id: docSnapshot.id,
    eventId: trimText(data.eventId),
    eventTitle: trimText(data.eventTitle),
    organizationId: trimText(data.organizationId),
    title: trimText(data.title),
    message: trimText(data.message),
    recipientCount:
      typeof data.recipientCount === 'number' && Number.isFinite(data.recipientCount)
        ? data.recipientCount
        : 0,
    createdAt: data.createdAt,
  };
};

export const mapVolunteerNotificationDoc = (
  docSnapshot: QueryDocumentSnapshot<DocumentData>,
): VolunteerNotificationItem => {
  const data = docSnapshot.data();

  return {
    id: docSnapshot.id,
    userId: trimText(data.userId),
    organizationId: trimText(data.organizationId),
    eventId: trimText(data.eventId),
    eventTitle: trimText(data.eventTitle),
    title: trimText(data.title),
    message: trimText(data.message),
    read: Boolean(data.read),
    createdAt: data.createdAt,
  };
};

export const mapOrganizationNotificationDoc = (
  docSnapshot: QueryDocumentSnapshot<DocumentData>,
): OrganizationNotificationItem => {
  const data = docSnapshot.data();

  return {
    id: docSnapshot.id,
    organizationId: trimText(data.organizationId),
    eventId: trimText(data.eventId),
    eventTitle: trimText(data.eventTitle),
    volunteerId: trimText(data.volunteerId),
    volunteerName: trimText(data.volunteerName) || 'Волонтёр',
    volunteerHandle: trimText(data.volunteerHandle),
    volunteerAvatarUrl: trimText(data.volunteerAvatarUrl) || null,
    read: Boolean(data.read),
    createdAt: data.createdAt,
  };
};

export const mapFirestoreEvent = (docSnapshot: QueryDocumentSnapshot<DocumentData>): EventItem => {
  const data = docSnapshot.data();

  return {
    id: docSnapshot.id,
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : '',
    category: typeof data.category === 'string' ? data.category : 'All',
    tags: Array.isArray(data.tags) ? data.tags.filter((item) => typeof item === 'string') : [],
    date: typeof data.date === 'string' ? data.date : '',
    duration: typeof data.duration === 'string' ? data.duration : '',
    location: typeof data.location === 'string' ? data.location : '',
    imageUrl:
      typeof data.imageUrl === 'string' && data.imageUrl.trim().length > 0
        ? data.imageUrl
        : FALLBACK_EVENT_IMAGE,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    createdByRole: 'organization',
    isPopular: Boolean(data.isPopular),
    isRecommended: Boolean(data.isRecommended),
    createdAt: data.createdAt,
    rawInput: typeof data.rawInput === 'string' ? data.rawInput : undefined,
    aiQuestionnaireAnswers:
      data.aiQuestionnaireAnswers && typeof data.aiQuestionnaireAnswers === 'object'
        ? Object.entries(data.aiQuestionnaireAnswers as Record<string, unknown>).reduce<Record<string, string>>(
            (accumulator, [key, value]) => {
              if (typeof value === 'string' && value.trim()) {
                accumulator[key] = value.trim();
              }

              return accumulator;
            },
            {},
          )
        : undefined,
  };
};

export async function createEvent(input: CreateEventInput, currentUser: User): Promise<string> {
  if (!currentUser?.uid) {
    throw new EventServiceError('Сначала войдите в аккаунт организации.');
  }

  try {
    const docRef = await addDoc(collection(db, 'events'), {
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category.trim(),
      tags: input.tags,
      date: input.date.trim(),
      duration: input.duration.trim(),
      location: input.location.trim(),
      imageUrl: input.imageUrl.trim() || FALLBACK_EVENT_IMAGE,
      createdBy: currentUser.uid,
      createdByRole: 'organization',
      isPopular: Boolean(input.isPopular),
      isRecommended: Boolean(input.isRecommended),
      createdAt: serverTimestamp(),
      ...(input.rawInput ? { rawInput: input.rawInput.trim() } : {}),
      ...(input.aiQuestionnaireAnswers ? { aiQuestionnaireAnswers: input.aiQuestionnaireAnswers } : {}),
    });

    // TODO: parse raw organization input into structured event drafts with AI.
    // TODO: let AI determine isPopular / isRecommended instead of exposing manual flags in the form.
    // TODO: generate event embeddings for volunteer-event semantic matching.
    // TODO: power recommended events for volunteers from embeddings and profile context.
    // TODO: support RAG Q&A over event details and organization-provided context.
    return docRef.id;
  } catch (error) {
    throw toEventServiceError(error);
  }
}

export function subscribeToEvents(
  callback: (events: EventItem[]) => void,
  onError?: (message: string) => void,
) {
  const eventsQuery = query(collection(db, 'events'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    eventsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      callback(snapshot.docs.map(mapFirestoreEvent));
    },
    (error) => {
      onError?.(getReadableEventError(error));
    },
  );
}

export async function getEvents(): Promise<EventItem[]> {
  try {
    const eventsQuery = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(eventsQuery);
    return snapshot.docs.map(mapFirestoreEvent);
  } catch (error) {
    throw toEventServiceError(error);
  }
}

export async function toggleSavedEvent(
  eventId: string,
  currentUser: User,
  shouldRemove: boolean,
): Promise<void> {
  if (!currentUser?.uid) {
    throw new EventServiceError('Сначала войдите в аккаунт волонтёра.');
  }

  const savedEventRef = doc(db, 'users', currentUser.uid, USER_SAVED_EVENTS_SUBCOLLECTION, eventId);

  try {
    if (shouldRemove) {
      await deleteDoc(savedEventRef);
      return;
    }

    await setDoc(savedEventRef, {
      eventId,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    throw toEventServiceError(error);
  }
}

export function subscribeToSavedEvents(
  userId: string,
  callback: (eventIds: string[]) => void,
  onError?: (message: string) => void,
) {
  const savedEventsQuery = query(
    collection(db, 'users', userId, USER_SAVED_EVENTS_SUBCOLLECTION),
    orderBy('createdAt', 'desc'),
  );

  return onSnapshot(
    savedEventsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      callback(
        snapshot.docs
          .map((docSnapshot) => trimText(docSnapshot.id) || trimText(docSnapshot.data().eventId))
          .filter(Boolean),
      );
    },
    (error) => {
      onError?.(getReadableEventError(error));
    },
  );
}

export async function joinEvent(event: EventItem, currentUser: User): Promise<string> {
  if (!currentUser?.uid) {
    throw new EventServiceError('Сначала войдите в аккаунт волонтёра.');
  }

  const participationId = `${event.id}_${currentUser.uid}`;
  const participationRef = doc(db, PARTICIPATIONS_COLLECTION, participationId);

  try {
    const existingParticipationSnapshot = await getDoc(participationRef);

    if (existingParticipationSnapshot.exists()) {
      const existingStatus = trimText(existingParticipationSnapshot.data().status) as EventParticipationItem['status'];

      if (isActiveParticipationStatus(existingStatus)) {
        return participationId;
      }
    }

    const [userSnapshot, profileSnapshot] = await Promise.all([
      getDoc(doc(db, 'users', currentUser.uid)),
      getDoc(doc(db, 'volunteerProfiles', currentUser.uid)),
    ]);

    const userData = userSnapshot.exists() ? userSnapshot.data() : {};
    const profileData = profileSnapshot.exists() ? (profileSnapshot.data() as Partial<VolunteerProfileData>) : {};

    const volunteerName =
      trimText(profileData.fullName) ||
      trimText(userData.displayName) ||
      trimText(currentUser.displayName) ||
      'Волонтёр';
    const volunteerHandle = trimText(profileData.handle) || trimText(userData.username);
    const volunteerAvatarUrl = trimText(profileData.avatarUrl) || trimText(userData.avatarUrl) || null;

    const batch = writeBatch(db);

    batch.set(
      participationRef,
      {
        eventId: event.id,
        eventTitle: event.title.trim(),
        organizationId: event.createdBy,
        userId: currentUser.uid,
        status: 'joined',
        hours: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const organizationNotificationRef = doc(collection(db, ORGANIZATION_NOTIFICATIONS_COLLECTION));
    batch.set(organizationNotificationRef, {
      organizationId: event.createdBy,
      eventId: event.id,
      eventTitle: event.title.trim(),
      volunteerId: currentUser.uid,
      volunteerName,
      volunteerHandle,
      volunteerAvatarUrl,
      read: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    return participationId;
  } catch (error) {
    throw toEventServiceError(error);
  }
}

export function subscribeToUserParticipations(
  userId: string,
  callback: (items: EventParticipationItem[]) => void,
  onError?: (message: string) => void,
) {
  const participationsQuery = query(
    collection(db, PARTICIPATIONS_COLLECTION),
    where('userId', '==', userId),
  );

  return onSnapshot(
    participationsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      callback(snapshot.docs.map(mapParticipationDoc));
    },
    (error) => {
      onError?.(getReadableEventError(error));
    },
  );
}

export async function removeVolunteerFromEvent(participationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, PARTICIPATIONS_COLLECTION, participationId), {
      status: 'removed',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    throw toEventServiceError(error);
  }
}

export function subscribeToOrganizationRegistrations(
  organizationId: string,
  callback: (items: RegisteredVolunteerCard[]) => void,
  onError?: (message: string) => void,
) {
  const participationsQuery = query(
    collection(db, PARTICIPATIONS_COLLECTION),
    where('organizationId', '==', organizationId),
  );

  return onSnapshot(
    participationsQuery,
    async (snapshot: QuerySnapshot<DocumentData>) => {
      try {
        const participations = snapshot.docs
          .map(mapParticipationDoc)
          .filter((item) => isActiveParticipationStatus(item.status));

        if (participations.length === 0) {
          callback([]);
          return;
        }

        const uniqueUserIds = Array.from(new Set(participations.map((item) => item.userId).filter(Boolean)));
        const profileEntries = await Promise.all(
          uniqueUserIds.map(async (userId) => {
            const [userSnapshot, profileSnapshot] = await Promise.all([
              getDoc(doc(db, 'users', userId)),
              getDoc(doc(db, 'volunteerProfiles', userId)),
            ]);

            const userData = userSnapshot.exists() ? userSnapshot.data() : {};
            const profileData = profileSnapshot.exists()
              ? (profileSnapshot.data() as Partial<VolunteerProfileData>)
              : {};

            return [
              userId,
              {
                fullName:
                  trimText(profileData.fullName) ||
                  trimText(userData.displayName) ||
                  'Волонтёр',
                handle: trimText(profileData.handle) || trimText(userData.username),
                avatarUrl: trimText(profileData.avatarUrl) || trimText(userData.avatarUrl) || null,
                skills: Array.isArray(profileData.skills)
                  ? profileData.skills.filter((item) => typeof item === 'string')
                  : [],
              },
            ] as const;
          }),
        );

        const volunteerMap = new Map(profileEntries);
        const cards = participations
          .map<RegisteredVolunteerCard>((item) => {
            const volunteer = volunteerMap.get(item.userId);

            return {
              participationId: item.id,
              userId: item.userId,
              eventId: item.eventId,
              eventTitle: item.eventTitle,
              status: item.status,
              createdAt: item.createdAt,
              volunteerName: volunteer?.fullName || 'Волонтёр',
              volunteerHandle: volunteer?.handle || '',
              volunteerAvatarUrl: volunteer?.avatarUrl || null,
              skills: volunteer?.skills || [],
            };
          })
          .sort((left, right) => {
            const leftDate = toDateValue(left.createdAt)?.getTime() ?? 0;
            const rightDate = toDateValue(right.createdAt)?.getTime() ?? 0;
            return rightDate - leftDate;
          });

        callback(cards);
      } catch (error) {
        onError?.(getReadableEventError(error));
      }
    },
    (error) => {
      onError?.(getReadableEventError(error));
    },
  );
}

export async function createEventAnnouncement(
  input: CreateEventAnnouncementInput,
  currentUser: User,
): Promise<string> {
  if (!currentUser?.uid) {
    throw new EventServiceError('Сначала войдите в аккаунт организации.');
  }

  try {
    const participationsSnapshot = await getDocs(
      query(collection(db, PARTICIPATIONS_COLLECTION), where('eventId', '==', input.eventId)),
    );

    const activeParticipations = participationsSnapshot.docs
      .map(mapParticipationDoc)
      .filter(
        (item) =>
          item.organizationId === currentUser.uid &&
          isActiveParticipationStatus(item.status) &&
          Boolean(item.userId),
      );

    if (activeParticipations.length === 0) {
      throw new EventServiceError('Пока некому отправлять сообщение: на событие ещё никто не записался.');
    }

    const batch = writeBatch(db);
    const announcementRef = doc(collection(db, EVENT_ANNOUNCEMENTS_COLLECTION));

    batch.set(announcementRef, {
      eventId: input.eventId,
      eventTitle: input.eventTitle.trim(),
      organizationId: currentUser.uid,
      title: input.title.trim(),
      message: input.message.trim(),
      recipientCount: activeParticipations.length,
      createdAt: serverTimestamp(),
    });

    activeParticipations.forEach((participation) => {
      const notificationRef = doc(collection(db, VOLUNTEER_NOTIFICATIONS_COLLECTION));

      batch.set(notificationRef, {
        userId: participation.userId,
        organizationId: currentUser.uid,
        eventId: input.eventId,
        eventTitle: input.eventTitle.trim(),
        title: input.title.trim(),
        message: input.message.trim(),
        announcementId: announcementRef.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    await batch.commit();

    // TODO: fan out organizer announcements to push notifications / in-app inbox.
    // TODO: let AI summarize or personalize organizer announcements per volunteer profile.
    return announcementRef.id;
  } catch (error) {
    if (error instanceof EventServiceError) {
      throw error;
    }

    throw toEventServiceError(error);
  }
}

export function subscribeToOrganizationAnnouncements(
  organizationId: string,
  callback: (items: EventAnnouncementItem[]) => void,
  onError?: (message: string) => void,
) {
  const announcementsQuery = query(
    collection(db, EVENT_ANNOUNCEMENTS_COLLECTION),
    where('organizationId', '==', organizationId),
  );

  return onSnapshot(
    announcementsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      const items = snapshot.docs
        .map(mapAnnouncementDoc)
        .sort((left, right) => {
          const leftDate = toDateValue(left.createdAt)?.getTime() ?? 0;
          const rightDate = toDateValue(right.createdAt)?.getTime() ?? 0;
          return rightDate - leftDate;
        });

      callback(items);
    },
    (error) => {
      onError?.(getReadableEventError(error));
    },
  );
}

export function subscribeToVolunteerNotifications(
  userId: string,
  callback: (items: VolunteerNotificationItem[]) => void,
  onError?: (message: string) => void,
) {
  const notificationsQuery = query(
    collection(db, VOLUNTEER_NOTIFICATIONS_COLLECTION),
    where('userId', '==', userId),
  );

  return onSnapshot(
    notificationsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      const items = snapshot.docs
        .map(mapVolunteerNotificationDoc)
        .sort((left, right) => {
          const leftDate = toDateValue(left.createdAt)?.getTime() ?? 0;
          const rightDate = toDateValue(right.createdAt)?.getTime() ?? 0;
          return rightDate - leftDate;
        });

      callback(items);
    },
    (error) => {
      onError?.(getReadableEventError(error));
    },
  );
}

export async function markVolunteerNotificationsRead(notificationIds: string[]): Promise<void> {
  const ids = notificationIds.map((item) => item.trim()).filter(Boolean);

  if (ids.length === 0) {
    return;
  }

  try {
    const batch = writeBatch(db);

    ids.forEach((notificationId) => {
      batch.update(doc(db, VOLUNTEER_NOTIFICATIONS_COLLECTION, notificationId), {
        read: true,
      });
    });

    await batch.commit();
  } catch (error) {
    throw toEventServiceError(error);
  }
}

export function subscribeToOrganizationNotifications(
  organizationId: string,
  callback: (items: OrganizationNotificationItem[]) => void,
  onError?: (message: string) => void,
) {
  const notificationsQuery = query(
    collection(db, ORGANIZATION_NOTIFICATIONS_COLLECTION),
    where('organizationId', '==', organizationId),
  );

  return onSnapshot(
    notificationsQuery,
    (snapshot: QuerySnapshot<DocumentData>) => {
      const items = snapshot.docs
        .map(mapOrganizationNotificationDoc)
        .sort((left, right) => {
          const leftDate = toDateValue(left.createdAt)?.getTime() ?? 0;
          const rightDate = toDateValue(right.createdAt)?.getTime() ?? 0;
          return rightDate - leftDate;
        });

      callback(items);
    },
    (error) => {
      onError?.(getReadableEventError(error));
    },
  );
}

export async function markOrganizationNotificationsRead(notificationIds: string[]): Promise<void> {
  const ids = notificationIds.map((item) => item.trim()).filter(Boolean);

  if (ids.length === 0) {
    return;
  }

  try {
    const batch = writeBatch(db);

    ids.forEach((notificationId) => {
      batch.update(doc(db, ORGANIZATION_NOTIFICATIONS_COLLECTION, notificationId), {
        read: true,
      });
    });

    await batch.commit();
  } catch (error) {
    throw toEventServiceError(error);
  }
}

export { EventServiceError, FALLBACK_EVENT_IMAGE };
