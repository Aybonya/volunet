import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import CreateEventScreen from './CreateEventScreen';
import CreateAnnouncementScreen from './CreateAnnouncementScreen';
import OrganizationProfileScreen from './OrganizationProfileScreen';
import VolunteerProfileScreen from './VolunteerProfileScreen';
import { getCurrentUser, logout } from '../services/authService';
import {
  FALLBACK_EVENT_IMAGE,
  joinEvent,
  markOrganizationNotificationsRead,
  markVolunteerNotificationsRead,
  removeVolunteerFromEvent,
  subscribeToOrganizationAnnouncements,
  subscribeToOrganizationNotifications,
  subscribeToEvents,
  subscribeToOrganizationRegistrations,
  subscribeToSavedEvents,
  subscribeToUserParticipations,
  subscribeToVolunteerNotifications,
  toggleSavedEvent,
} from '../services/eventService';
import { answerEventQuestion, generateMatchExplanation } from '../services/openaiService';
import { subscribeToVolunteerProfile } from '../services/volunteerProfileService';
import { UserRole } from '../types/auth';
import {
  EventAnnouncementItem,
  EventCategory,
  EventItem,
  EventParticipationItem,
  OrganizationNotificationItem,
  RegisteredVolunteerCard,
  VolunteerNotificationItem,
} from '../types/event';
import { VolunteerProfileData } from '../types/profile';

type EventsFeedScreenProps = {
  currentUserRole: UserRole;
  onOpenNotifications?: () => void;
  onOpenMenu?: () => void;
  onOpenCreateEvent?: () => void;
};

type BottomTabKey = 'home' | 'match' | 'saved' | 'profile';

type CategoryOption = {
  key: EventCategory;
  label: string;
  icon: number;
  accent: string;
};

type BottomTabOption = {
  key: BottomTabKey;
  label: string;
  icon: number;
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  { key: 'All', label: 'All', icon: require('../assets/icons/categories/all.png'), accent: '#F1ECFF' },
  { key: 'Design', label: 'Design', icon: require('../assets/icons/categories/design.png'), accent: '#FFEAF1' },
  { key: 'IT', label: 'IT', icon: require('../assets/icons/categories/it.png'), accent: '#EAF4FF' },
  {
    key: 'Environment',
    label: 'Environment',
    icon: require('../assets/icons/categories/environment.png'),
    accent: '#EDF8E9',
  },
  { key: 'Social', label: 'Social', icon: require('../assets/icons/categories/social.png'), accent: '#FFF2E5' },
];

const BOTTOM_TABS: BottomTabOption[] = [
  { key: 'home', label: 'Главная', icon: require('../assets/icons/categories/home.png') },
  { key: 'match', label: 'Матч', icon: require('../assets/icons/categories/match.png') },
  { key: 'saved', label: 'Сохран.', icon: require('../assets/icons/categories/saved.png') },
  { key: 'profile', label: 'Профиль', icon: require('../assets/icons/categories/profile.png') },
];

const normalizeSearchValue = (value: string) => value.trim().toLowerCase();

const matchesCategory = (event: EventItem, category: EventCategory) =>
  category === 'All' || event.category === category;

const matchesSearch = (event: EventItem, searchQuery: string) => {
  if (!searchQuery) {
    return true;
  }

  const normalized = normalizeSearchValue(searchQuery);
  const haystack = [event.title, event.category, event.description, event.location, ...event.tags]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalized);
};

const formatTag = (tag: string) => `#${tag}`;

const SearchIcon = () => (
  <View style={styles.searchGlyph}>
    <View style={styles.searchCircle} />
    <View style={styles.searchHandle} />
  </View>
);

const NotificationBellIcon = () => (
  <Image
    resizeMode="contain"
    source={require('../assets/icons/categories/bell-cutout.png')}
    style={styles.notificationIconImage}
  />
);

const MenuIcon = () => (
  <View style={styles.menuIcon}>
    <View style={styles.menuLine} />
    <View style={styles.menuLine} />
    <View style={styles.menuLine} />
  </View>
);

const initialsFromName = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (parts.length === 0) {
    return 'V';
  }

  return parts.map((item) => item[0]?.toUpperCase() ?? '').join('') || 'V';
};

const toMaybeDate = (value: any) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate();
  }

  const parsed = new Date(value);
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

  if (localizedMatch) {
    const [, dayValue, monthName, yearValue, hours = '12', minutes = '00'] = localizedMatch;
    const monthIndex = RUSSIAN_MONTHS[monthName];

    if (typeof monthIndex === 'number') {
      const now = new Date();
      const resolvedYear = yearValue ? Number(yearValue) : now.getFullYear();
      let parsed = new Date(resolvedYear, monthIndex, Number(dayValue), Number(hours), Number(minutes));

      if (!yearValue && parsed.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
        parsed = new Date(resolvedYear + 1, monthIndex, Number(dayValue), Number(hours), Number(minutes));
      }

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
};

const formatDateTime = (value: any) => {
  const date = toMaybeDate(value);

  if (!date) {
    return 'Время подачи неизвестно';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const buildCountdownLabel = (eventDate: Date | null, now: Date) => {
  if (!eventDate) {
    return {
      tone: 'neutral' as const,
      label: 'Дата требует уточнения',
      shortLabel: 'Нет таймера',
    };
  }

  const diff = eventDate.getTime() - now.getTime();

  if (diff <= 0) {
    return {
      tone: 'late' as const,
      label: 'Событие уже началось или прошло',
      shortLabel: 'Время вышло',
    };
  }

  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return {
      tone: 'good' as const,
      label: `До старта ${days}д ${hours}ч`,
      shortLabel: `${days}д ${hours}ч`,
    };
  }

  if (hours > 0) {
    return {
      tone: 'warning' as const,
      label: `До старта ${hours}ч ${minutes}м`,
      shortLabel: `${hours}ч ${minutes}м`,
    };
  }

  return {
    tone: 'late' as const,
    label: `До старта ${Math.max(minutes, 0)}м`,
    shortLabel: `${Math.max(minutes, 0)}м`,
  };
};

const tokenizeForMatch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-zа-я0-9\s-]/gi, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);

const getVolunteerMatchTokens = (profile: VolunteerProfileData) =>
  new Set(
    [
      profile.bio,
      profile.aiAbout,
      profile.city,
      ...profile.skills,
      ...profile.interests,
      ...profile.causes,
      ...profile.availability,
    ].flatMap((item) => tokenizeForMatch(item)),
  );

const getEventMatchTokens = (event: EventItem) =>
  new Set(
    [event.title, event.description, event.category, event.location, event.duration, ...event.tags].flatMap((item) =>
      tokenizeForMatch(item),
    ),
  );

const calculateVolunteerEventMatchScore = (profile: VolunteerProfileData | null, event: EventItem) => {
  if (!profile) {
    return event.isRecommended ? 82 : event.isPopular ? 74 : 0;
  }

  const volunteerTokens = getVolunteerMatchTokens(profile);
  const eventTokens = getEventMatchTokens(event);
  let overlapScore = 0;

  eventTokens.forEach((token) => {
    if (volunteerTokens.has(token)) {
      overlapScore += 14;
    }
  });

  const causeBonus = profile.causes.some((item) => {
    const normalized = item.toLowerCase();
    return event.category.toLowerCase().includes(normalized) || event.description.toLowerCase().includes(normalized);
  })
    ? 12
    : 0;

  const recommendationBonus = event.isRecommended ? 10 : event.isPopular ? 6 : 0;
  const rawScore = 34 + overlapScore + causeBonus + recommendationBonus;

  return Math.max(38, Math.min(98, rawScore));
};

export default function EventsFeedScreen({
  currentUserRole,
  onOpenNotifications,
  onOpenMenu,
  onOpenCreateEvent,
}: EventsFeedScreenProps) {
  const currentUser = getCurrentUser();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [activeTab, setActiveTab] = useState<BottomTabKey>('home');
  const [selectedCategory, setSelectedCategory] = useState<EventCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedEventIds, setSavedEventIds] = useState<string[]>([]);
  const [participations, setParticipations] = useState<EventParticipationItem[]>([]);
  const [organizationRegistrations, setOrganizationRegistrations] = useState<RegisteredVolunteerCard[]>([]);
  const [organizationAnnouncements, setOrganizationAnnouncements] = useState<EventAnnouncementItem[]>([]);
  const [organizationNotifications, setOrganizationNotifications] = useState<OrganizationNotificationItem[]>([]);
  const [volunteerNotifications, setVolunteerNotifications] = useState<VolunteerNotificationItem[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<VolunteerProfileData | null>(null);
  const [matchExplanations, setMatchExplanations] = useState<Record<string, string>>({});
  const [displayedMatchExplanations, setDisplayedMatchExplanations] = useState<Record<string, string>>({});
  const [matchExplanationErrors, setMatchExplanationErrors] = useState<Record<string, string>>({});
  const [loadingMatchIds, setLoadingMatchIds] = useState<string[]>([]);
  const [showAiQuestionModal, setShowAiQuestionModal] = useState(false);
  const [selectedAiEvent, setSelectedAiEvent] = useState<EventItem | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [displayedAiAnswer, setDisplayedAiAnswer] = useState('');
  const [aiAnswerError, setAiAnswerError] = useState<string | null>(null);
  const [isAiAnswering, setIsAiAnswering] = useState(false);
  const [aiAnswerHighlighted, setAiAnswerHighlighted] = useState(false);
  const [matchDecisions, setMatchDecisions] = useState<Record<string, 'like' | 'dislike'>>({});
  const [matchDecisionLoadingId, setMatchDecisionLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAnnouncementCenter, setShowAnnouncementCenter] = useState(false);
  const [showAnnouncementComposer, setShowAnnouncementComposer] = useState(false);
  const [showMenuDrawer, setShowMenuDrawer] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [selectedAnnouncementEvent, setSelectedAnnouncementEvent] = useState<EventItem | null>(null);
  const [joiningEventId, setJoiningEventId] = useState<string | null>(null);
  const [removingParticipationId, setRemovingParticipationId] = useState<string | null>(null);
  const [expandedOrganizationEventIds, setExpandedOrganizationEventIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());
  const aiModalScrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = subscribeToEvents(
      (nextEvents) => {
        setEvents(nextEvents);
        setLoading(false);
      },
      (message) => {
        setError(message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (currentUserRole !== 'volunteer' || !currentUser?.uid) {
      setParticipations([]);
      return;
    }

    return subscribeToUserParticipations(
      currentUser.uid,
      (items) => {
        setParticipations(items);
      },
      (message) => {
        setError(message);
      },
    );
  }, [currentUser?.uid, currentUserRole]);

  useEffect(() => {
    if (currentUserRole !== 'volunteer' || !currentUser?.uid) {
      setSavedEventIds([]);
      return;
    }

    return subscribeToSavedEvents(
      currentUser.uid,
      (eventIds) => {
        setSavedEventIds(eventIds);
      },
      (message) => {
        setError(message);
      },
    );
  }, [currentUser?.uid, currentUserRole]);

  useEffect(() => {
    if (currentUserRole !== 'volunteer' || !currentUser) {
      setVolunteerProfile(null);
      setMatchExplanations({});
      setDisplayedMatchExplanations({});
      setMatchExplanationErrors({});
      setLoadingMatchIds([]);
      return;
    }

    return subscribeToVolunteerProfile(
      currentUser,
      (profile) => {
        setVolunteerProfile(profile);
      },
      (message) => {
        setError(message);
      },
    );
  }, [currentUser?.uid, currentUserRole]);

  useEffect(() => {
    if (currentUserRole !== 'organization' || !currentUser?.uid) {
      setOrganizationRegistrations([]);
      return;
    }

    return subscribeToOrganizationRegistrations(
      currentUser.uid,
      (items) => {
        setOrganizationRegistrations(items);
      },
      (message) => {
        setError(message);
      },
    );
  }, [currentUser?.uid, currentUserRole]);

  useEffect(() => {
    if (currentUserRole !== 'organization' || !currentUser?.uid) {
      setOrganizationAnnouncements([]);
      return;
    }

    return subscribeToOrganizationAnnouncements(
      currentUser.uid,
      (items) => {
        setOrganizationAnnouncements(items);
      },
      (message) => {
        setError(message);
      },
    );
  }, [currentUser?.uid, currentUserRole]);

  useEffect(() => {
    if (currentUserRole !== 'organization' || !currentUser?.uid) {
      setOrganizationNotifications([]);
      return;
    }

    return subscribeToOrganizationNotifications(
      currentUser.uid,
      (items) => {
        setOrganizationNotifications(items);
      },
      (message) => {
        setError(message);
      },
    );
  }, [currentUser?.uid, currentUserRole]);

  useEffect(() => {
    if (currentUserRole !== 'volunteer' || !currentUser?.uid) {
      setVolunteerNotifications([]);
      return;
    }

    return subscribeToVolunteerNotifications(
      currentUser.uid,
      (items) => {
        setVolunteerNotifications(items);
      },
      (message) => {
        setError(message);
      },
    );
  }, [currentUser?.uid, currentUserRole]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      currentUserRole !== 'volunteer' ||
      activeTab !== 'match' ||
      !volunteerProfile
    ) {
      return;
    }

    const availableMatchEvents = [...events]
      .map((event) => ({
        event,
        score: calculateVolunteerEventMatchScore(volunteerProfile, event),
      }))
      .filter(({ event, score }) => (score > 0 || event.isPopular || event.isRecommended) && !matchDecisions[event.id])
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        const leftDate = toMaybeDate(left.event.createdAt)?.getTime() ?? 0;
        const rightDate = toMaybeDate(right.event.createdAt)?.getTime() ?? 0;
        return rightDate - leftDate;
      })
      .map((item) => item.event)
      .slice(0, 2);

    const target = availableMatchEvents[0];

    if (!target) {
      return;
    }

    if (
      matchExplanations[target.id] ||
      matchExplanationErrors[target.id] ||
      loadingMatchIds.includes(target.id)
    ) {
      return;
    }

    let cancelled = false;
    setLoadingMatchIds((current) => Array.from(new Set([...current, target.id])));

    const run = async () => {
      try {
        const explanation = await generateMatchExplanation(volunteerProfile, target);

        if (!cancelled) {
          setMatchExplanations((current) => ({ ...current, [target.id]: explanation }));
        }
      } catch (serviceError) {
        if (!cancelled) {
          setMatchExplanationErrors((current) => ({
            ...current,
            [target.id]:
              serviceError instanceof Error
                ? serviceError.message
                : 'Не удалось получить AI-объяснение мэтча.',
          }));
        }
      } finally {
        setLoadingMatchIds((current) => current.filter((id) => id !== target.id));
      }

      const nextTarget = availableMatchEvents[1];

      if (
        cancelled ||
        !nextTarget ||
        matchExplanations[nextTarget.id] ||
        matchExplanationErrors[nextTarget.id] ||
        loadingMatchIds.includes(nextTarget.id)
      ) {
        return;
      }

      setLoadingMatchIds((current) => Array.from(new Set([...current, nextTarget.id])));

      try {
        const nextExplanation = await generateMatchExplanation(volunteerProfile, nextTarget);

        if (!cancelled) {
          setMatchExplanations((current) => ({ ...current, [nextTarget.id]: nextExplanation }));
        }
      } catch (serviceError) {
        if (!cancelled) {
          setMatchExplanationErrors((current) => ({
            ...current,
            [nextTarget.id]:
              serviceError instanceof Error
                ? serviceError.message
                : 'Не удалось получить AI-объяснение мэтча.',
          }));
        }
      } finally {
        setLoadingMatchIds((current) => current.filter((id) => id !== nextTarget.id));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    currentUserRole,
    events,
    matchDecisions,
    matchExplanationErrors,
    matchExplanations,
    volunteerProfile,
  ]);

  const filteredEvents = events.filter(
    (event) => matchesCategory(event, selectedCategory) && matchesSearch(event, searchQuery),
  );
  const savedEvents = events.filter((event) => savedEventIds.includes(event.id));
  const matchedEvents = events.filter((event) => event.isRecommended || event.isPopular);
  const matchScores = useMemo(
    () =>
      events.reduce<Record<string, number>>((accumulator, event) => {
        accumulator[event.id] = calculateVolunteerEventMatchScore(volunteerProfile, event);
        return accumulator;
      }, {}),
    [events, volunteerProfile],
  );
  const recommendedEvents = useMemo(() => {
    if (currentUserRole === 'volunteer' && volunteerProfile) {
      return [...events]
        .map((event) => ({
          event,
          score: matchScores[event.id] ?? 0,
        }))
        .filter(({ event, score }) => score > 0 || event.isPopular || event.isRecommended)
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }

          const leftDate = toMaybeDate(left.event.createdAt)?.getTime() ?? 0;
          const rightDate = toMaybeDate(right.event.createdAt)?.getTime() ?? 0;
          return rightDate - leftDate;
        })
        .map((item) => item.event)
        .slice(0, 8);
    }

    return matchedEvents.length > 0 ? matchedEvents : events.slice(0, 6);
  }, [currentUserRole, events, matchScores, matchedEvents, volunteerProfile]);
  const remainingMatchEvents = useMemo(
    () => recommendedEvents.filter((event) => !matchDecisions[event.id]),
    [matchDecisions, recommendedEvents],
  );
  const currentMatchEvent = remainingMatchEvents[0] ?? null;
  const currentMatchExplanation = currentMatchEvent ? matchExplanations[currentMatchEvent.id] ?? '' : '';

  useEffect(() => {
    const currentEventId = currentMatchEvent?.id;

    if (!currentEventId || !currentMatchExplanation) {
      return;
    }

    setDisplayedMatchExplanations((current) => ({
      ...current,
      [currentEventId]: '',
    }));

    let frame = 0;
    const timer = setInterval(() => {
      frame += 5;
      const nextText = currentMatchExplanation.slice(0, frame);

      setDisplayedMatchExplanations((current) => ({
        ...current,
        [currentEventId]: nextText,
      }));

      if (nextText.length >= currentMatchExplanation.length) {
        clearInterval(timer);
      }
    }, 18);

    return () => clearInterval(timer);
  }, [currentMatchEvent?.id, currentMatchExplanation]);

  useEffect(() => {
    if (!showAiQuestionModal || !displayedAiAnswer) {
      return;
    }

    const scrollTimer = setTimeout(() => {
      aiModalScrollRef.current?.scrollToEnd({ animated: true });
    }, 180);

    return () => clearTimeout(scrollTimer);
  }, [displayedAiAnswer, showAiQuestionModal]);

  useEffect(() => {
    if (!aiAnswer) {
      setDisplayedAiAnswer('');
      return;
    }

    setDisplayedAiAnswer('');

    let frame = 0;
    const timer = setInterval(() => {
      frame += 5;
      const nextText = aiAnswer.slice(0, frame);
      setDisplayedAiAnswer(nextText);

      if (nextText.length >= aiAnswer.length) {
        clearInterval(timer);
      }
    }, 16);

    return () => clearInterval(timer);
  }, [aiAnswer]);

  useEffect(() => {
    if (!aiAnswerHighlighted) {
      return;
    }

    const highlightTimer = setTimeout(() => {
      setAiAnswerHighlighted(false);
    }, 2600);

    return () => clearTimeout(highlightTimer);
  }, [aiAnswerHighlighted]);
  const activeParticipations = participations.filter(
    (item) => item.status === 'joined' || item.status === 'accepted' || item.status === 'completed',
  );
  const joinedEventIds = new Set(activeParticipations.map((item) => item.eventId));
  const organizationEvents = useMemo(
    () => events.filter((event) => event.createdBy === currentUser?.uid),
    [currentUser?.uid, events],
  );
  const registrationsByEventId = useMemo(() => {
    const next = new Map<string, RegisteredVolunteerCard[]>();

    organizationRegistrations.forEach((item) => {
      const current = next.get(item.eventId) ?? [];
      current.push(item);
      next.set(item.eventId, current);
    });

    return next;
  }, [organizationRegistrations]);
  const uniqueRegisteredVolunteerCount = useMemo(
    () => new Set(organizationRegistrations.map((item) => item.userId)).size,
    [organizationRegistrations],
  );
  const announcementsCount = organizationAnnouncements.length;
  const unreadOrganizationNotificationsCount = organizationNotifications.filter((item) => !item.read).length;
  const unreadVolunteerNotificationsCount = volunteerNotifications.filter((item) => !item.read).length;
  const notificationBadgeCount =
    currentUserRole === 'organization'
      ? unreadOrganizationNotificationsCount
      : unreadVolunteerNotificationsCount;
  const resolvedTabs = useMemo(
    () =>
      currentUserRole === 'organization'
        ? BOTTOM_TABS.map((item) =>
            item.key === 'saved' ? { ...item, label: 'Мои ивенты' } : item,
          )
        : BOTTOM_TABS,
    [currentUserRole],
  );

  const toggleSaved = async (eventId: string) => {
    if (!currentUser || currentUserRole !== 'volunteer') {
      setError('Сохранять события могут только авторизованные волонтёры.');
      return;
    }

    const shouldRemove = savedEventIds.includes(eventId);

    setSavedEventIds((current) =>
      shouldRemove ? current.filter((id) => id !== eventId) : [...current, eventId],
    );

    try {
      setError(null);
      await toggleSavedEvent(eventId, currentUser, shouldRemove);
    } catch (saveError) {
      setSavedEventIds((current) =>
        shouldRemove ? [...current, eventId] : current.filter((id) => id !== eventId),
      );
      setError(saveError instanceof Error ? saveError.message : 'Не удалось обновить сохранённые события.');
    }
  };

  const toggleOrganizationEvent = (eventId: string) => {
    setExpandedOrganizationEventIds((current) =>
      current.includes(eventId) ? current.filter((id) => id !== eventId) : [...current, eventId],
    );
  };

  const resetMatchDeck = () => {
    setMatchDecisions({});
    setError(null);
  };

  const openCreateFlow = () => {
    if (onOpenCreateEvent) {
      onOpenCreateEvent();
      return;
    }

    setShowCreateModal(true);
  };

  const handleJoinEvent = async (event: EventItem) => {
    if (!currentUser) {
      setError('Сначала войдите в аккаунт волонтёра.');
      return;
    }

    if (joinedEventIds.has(event.id)) {
      return;
    }

    try {
      setJoiningEventId(event.id);
      setError(null);
      await joinEvent(event, currentUser);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Не удалось записаться на событие.');
    } finally {
      setJoiningEventId(null);
    }
  };

  const handleMatchDecision = async (event: EventItem, decision: 'like' | 'dislike') => {
    if (decision === 'dislike') {
      setMatchDecisions((current) => ({ ...current, [event.id]: 'dislike' }));
      return;
    }

    if (!currentUser || currentUserRole !== 'volunteer') {
      setError('Сохранять мэтчи могут только авторизованные волонтёры.');
      return;
    }

    setMatchDecisionLoadingId(event.id);
    setError(null);

    try {
      const alreadySaved = savedEventIds.includes(event.id);

      if (!alreadySaved) {
        setSavedEventIds((current) => [...current, event.id]);
        await toggleSavedEvent(event.id, currentUser, false);
      }

      setMatchDecisions((current) => ({ ...current, [event.id]: 'like' }));
    } catch (saveError) {
      setSavedEventIds((current) => current.filter((id) => id !== event.id));
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить этот мэтч.');
    } finally {
      setMatchDecisionLoadingId(null);
    }
  };

  const handleRemoveVolunteer = async (participationId: string) => {
    try {
      setRemovingParticipationId(participationId);
      setError(null);
      await removeVolunteerFromEvent(participationId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Не удалось убрать волонтёра из списка.');
    } finally {
      setRemovingParticipationId(null);
    }
  };

  const openAnnouncementComposer = (event: EventItem) => {
    setSelectedAnnouncementEvent(event);
    setShowAnnouncementComposer(true);
  };

  const openNotificationCenter = async () => {
    setShowAnnouncementCenter(true);

    try {
      if (currentUserRole === 'organization') {
        const unreadIds = organizationNotifications.filter((item) => !item.read).map((item) => item.id);

        if (unreadIds.length === 0) {
          return;
        }

        await markOrganizationNotificationsRead(unreadIds);
        return;
      }

      const unreadIds = volunteerNotifications.filter((item) => !item.read).map((item) => item.id);

      if (unreadIds.length === 0) {
        return;
      }

      await markVolunteerNotificationsRead(unreadIds);
    } catch (notificationError) {
      setError(
        notificationError instanceof Error
          ? notificationError.message
          : 'Не удалось отметить уведомления как прочитанные.',
      );
    }
  };

  const openAiQuestionModal = (event: EventItem) => {
    setSelectedAiEvent(event);
    setAiQuestion('');
    setAiAnswer('');
    setDisplayedAiAnswer('');
    setAiAnswerError(null);
    setAiAnswerHighlighted(false);
    setShowAiQuestionModal(true);
  };

  const handleOpenMenu = () => {
    setShowMenuDrawer(true);
    onOpenMenu?.();
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    setError(null);

    try {
      await logout();
      setShowMenuDrawer(false);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Не удалось выйти из аккаунта.');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleAskEventQuestion = async () => {
    if (!selectedAiEvent) {
      return;
    }

    if (!aiQuestion.trim()) {
      setAiAnswerError('Сначала введите вопрос по событию.');
      return;
    }

    setIsAiAnswering(true);
    setAiAnswer('');
    setDisplayedAiAnswer('');
    setAiAnswerError(null);

    try {
      const answer = await answerEventQuestion(selectedAiEvent, aiQuestion);
      setAiAnswer(answer);
      setAiAnswerHighlighted(true);
    } catch (serviceError) {
      setAiAnswerError(
        serviceError instanceof Error
          ? serviceError.message
          : 'Не удалось получить ответ по событию.',
      );
    } finally {
      setIsAiAnswering(false);
    }
  };

  const renderTopBar = () => (
    <View style={styles.headerRow}>
      <Text style={styles.logo}>Volunet</Text>

      <View style={styles.headerActions}>
        <Pressable
          onPress={() => void openNotificationCenter()}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <NotificationBellIcon />
          {notificationBadgeCount > 0 ? (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>
                {notificationBadgeCount > 9 ? '9+' : notificationBadgeCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={handleOpenMenu}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <MenuIcon />
        </Pressable>
      </View>
    </View>
  );

  const renderHomeHeader = () => (
    <View style={styles.headerBlock}>
      {renderTopBar()}

      <View style={styles.searchBar}>
        <SearchIcon />
        <TextInput
          onChangeText={setSearchQuery}
          placeholder="Поиск"
          placeholderTextColor="#8B92AD"
          style={styles.searchInput}
          value={searchQuery}
        />
      </View>

      <View style={styles.categoriesRow}>
        {CATEGORY_OPTIONS.map((item) => {
          const selected = item.key === selectedCategory;

          return (
            <Pressable
              key={item.key}
              onPress={() => setSelectedCategory(item.key)}
              style={({ pressed }) => [
                styles.categoryButton,
                selected && styles.categoryButtonSelected,
                pressed && styles.pressed,
              ]}
            >
              <Image resizeMode="contain" source={item.icon} style={styles.categoryIconImage} />
              <Text style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderPlainHeader = () => (
    <View style={styles.headerBlock}>
      {renderTopBar()}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderSectionHeader = (title: string, subtitle: string) => (
    <View style={styles.headerBlock}>
      {renderTopBar()}

      <View style={styles.sectionIntro}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderEventCard = ({ item }: { item: EventItem }) => {
    const saved = savedEventIds.includes(item.id);
    const joined = joinedEventIds.has(item.id);
    const showParticipateAction = currentUserRole === 'volunteer' && activeTab === 'saved';
    const showMatchInfo = currentUserRole === 'volunteer' && activeTab === 'match';
    const matchScore = matchScores[item.id] ?? 0;
    const matchExplanation = displayedMatchExplanations[item.id] ?? matchExplanations[item.id];
    const matchExplanationError = matchExplanationErrors[item.id];
    const isLoadingMatchExplanation = loadingMatchIds.includes(item.id);

    return (
      <View style={styles.card}>
        <ImageBackground
          imageStyle={styles.cardImage}
          source={{ uri: item.imageUrl || FALLBACK_EVENT_IMAGE }}
          style={styles.cardImageWrap}
        >
          <View style={styles.cardImageOverlay}>
            <View style={styles.badgesRow}>
              {item.isPopular ? (
                <View style={[styles.badge, styles.popularBadge]}>
                  <Text style={styles.badgeText}>🔥 Популярное</Text>
                </View>
              ) : null}
              {item.isRecommended ? (
                <View style={[styles.badge, styles.recommendedBadge]}>
                  <Text style={styles.badgeText}>🤖 Рекомендовано</Text>
                </View>
              ) : null}
            </View>

            <Pressable
              onPress={() => void toggleSaved(item.id)}
              style={({ pressed }) => [
                styles.saveButton,
                saved && styles.saveButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.saveIcon, saved && styles.saveIconActive]}>{saved ? '♥' : '♡'}</Text>
            </Pressable>
          </View>
        </ImageBackground>

        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.title}</Text>

          {item.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {item.tags.slice(0, 4).map((tag) => (
                <View key={`${item.id}-${tag}`} style={styles.tagPill}>
                  <Text style={styles.tagPillText}>{formatTag(tag)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaIcon}>📅</Text>
              <Text style={styles.metaText}>{item.date || 'Дата скоро появится'}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaIcon}>⏱</Text>
              <Text style={styles.metaText}>{item.duration || 'Время уточняется'}</Text>
            </View>
          </View>

          {item.location ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaIcon}>📍</Text>
              <Text style={styles.metaText}>{item.location}</Text>
            </View>
          ) : null}

          {item.description ? (
            <Text numberOfLines={2} style={styles.cardDescription}>
              {item.description}
            </Text>
          ) : null}

          {showMatchInfo ? (
            <View style={styles.matchCard}>
              <View style={styles.matchScoreRow}>
                <Text style={styles.matchScoreLabel}>AI match</Text>
                <Text style={styles.matchScoreValue}>{matchScore}%</Text>
              </View>

              {isLoadingMatchExplanation ? (
                <View style={styles.matchLoadingRow}>
                  <ActivityIndicator color="#3550E5" size="small" />
                  <Text style={styles.matchLoadingText}>AI готовит объяснение мэтча...</Text>
                </View>
              ) : matchExplanation ? (
                <Text style={styles.matchExplanationText}>{matchExplanation}</Text>
              ) : matchExplanationError ? (
                <Text style={styles.matchExplanationError}>{matchExplanationError}</Text>
              ) : (
                <Text style={styles.matchExplanationPlaceholder}>
                  AI скоро объяснит, почему это событие вам подходит.
                </Text>
              )}
            </View>
          ) : null}

          <Pressable
            onPress={() => openAiQuestionModal(item)}
            style={({ pressed }) => [styles.aiQuestionButton, pressed && styles.pressed]}
          >
            <Text style={styles.aiQuestionButtonText}>🤖 Ответ от AI</Text>
          </Pressable>

          {showParticipateAction ? (
            <View style={styles.cardActionRow}>
              <View style={[styles.joinStatusPill, joined && styles.joinStatusPillActive]}>
                <Text style={[styles.joinStatusText, joined && styles.joinStatusTextActive]}>
                  {joined ? 'Вы уже записаны' : 'Сохранено'}
                </Text>
              </View>

              <Pressable
                disabled={joined || joiningEventId === item.id}
                onPress={() => void handleJoinEvent(item)}
                style={({ pressed }) => [
                  styles.joinButton,
                  joined && styles.joinButtonActive,
                  (joined || joiningEventId === item.id) && styles.joinButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {joiningEventId === item.id ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.joinButtonText}>{joined ? 'Участвуете' : 'Поучаствовать'}</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const renderEmptyState = () => {
    if (loading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#223BD0" size="large" />
          <Text style={styles.emptyTitle}>Загружаем события</Text>
          <Text style={styles.emptySubtitle}>Подключаемся к Firestore и собираем свежую ленту Volunet.</Text>
        </View>
      );
    }

    if (activeTab === 'saved') {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Text style={styles.emptyEmoji}>⭐</Text>
          </View>
          <Text style={styles.emptyTitle}>Пока ничего не сохранено</Text>
          <Text style={styles.emptySubtitle}>
            Нажимайте на сердечко у карточек, чтобы собрать свои любимые возможности здесь.
          </Text>
        </View>
      );
    }

    if (activeTab === 'match') {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Text style={styles.emptyEmoji}>🤖</Text>
          </View>
          <Text style={styles.emptyTitle}>Подборки скоро появятся</Text>
          <Text style={styles.emptySubtitle}>
            Когда появятся рекомендованные или популярные события, они покажутся в этом разделе.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconWrap}>
          <Text style={styles.emptyEmoji}>🗓</Text>
        </View>
        <Text style={styles.emptyTitle}>Событий пока нет</Text>
        <Text style={styles.emptySubtitle}>
          Организации могут создать первую волонтёрскую возможность и заполнить эту ленту.
        </Text>
      </View>
    );
  };

  const renderProfileTab = () => (
    currentUserRole === 'volunteer' ? (
      <VolunteerProfileScreen
        activeTab="profile"
        embedded
        onOpenMenu={handleOpenMenu}
        onOpenNotifications={() => void openNotificationCenter()}
        showBottomBar={false}
      />
    ) : (
      <ScrollView contentContainerStyle={styles.profileScrollContent} showsVerticalScrollIndicator={false}>
        {renderSectionHeader('Профиль', 'Управляйте своим присутствием в Volunet как организация.')}

        <View style={styles.profileCard}>
          <Image
            resizeMode="contain"
            source={require('../assets/icons/categories/profile.png')}
            style={styles.profileIcon}
          />
          <Text style={styles.profileRoleLabel}>Организация</Text>
          <Text style={styles.profileHeadline}>Ваш кабинет готов к публикации событий</Text>
          <Text style={styles.profileDescription}>
            Создавайте новые активности, следите за откликами и постепенно разворачивайте AI-инструменты внутри Volunet.
          </Text>

          <View style={styles.profileStatsRow}>
            <View style={styles.profileStatCard}>
              <Text style={styles.profileStatValue}>{events.length}</Text>
              <Text style={styles.profileStatLabel}>Событий</Text>
            </View>
            <View style={styles.profileStatCard}>
              <Text style={styles.profileStatValue}>{savedEvents.length}</Text>
              <Text style={styles.profileStatLabel}>Сохранено</Text>
            </View>
            <View style={styles.profileStatCard}>
              <Text style={styles.profileStatValue}>{recommendedEvents.length}</Text>
              <Text style={styles.profileStatLabel}>Матчи</Text>
            </View>
          </View>
        </View>

        <View style={styles.profileHintCard}>
          <Text style={styles.profileHintTitle}>Следующий шаг</Text>
          <Text style={styles.profileHintText}>
            Опубликуйте новое событие через кнопку плюс и оно сразу появится в общей ленте.
          </Text>
        </View>
      </ScrollView>
    )
  );

  const renderOrganizationDashboard = () => (
    <ScrollView contentContainerStyle={styles.profileScrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.headerBlock}>
        {renderTopBar()}

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.orgHeroCard}>
        <View style={styles.orgHeroBadge}>
          <Text style={styles.orgHeroBadgeText}>Dashboard</Text>
        </View>
        <Text style={styles.orgHeroTitle}>Заявки на ваши события</Text>
        <Text style={styles.orgHeroDescription}>
          Следите, кто записался, смотрите сильные стороны волонтёров и при необходимости управляйте списком участников.
        </Text>
        <Pressable onPress={openCreateFlow} style={({ pressed }) => [styles.orgHeroButton, pressed && styles.pressed]}>
          <Text style={styles.orgHeroButtonText}>Создать событие</Text>
        </Pressable>
      </View>

      <View style={styles.orgStatsRow}>
        <View style={styles.orgStatCard}>
          <Text style={styles.orgStatValue}>{organizationEvents.length}</Text>
          <Text style={styles.orgStatLabel}>Ваших событий</Text>
        </View>
        <View style={styles.orgStatCard}>
          <Text style={styles.orgStatValue}>{organizationRegistrations.length}</Text>
          <Text style={styles.orgStatLabel}>Регистраций</Text>
        </View>
        <View style={styles.orgStatCard}>
          <Text style={styles.orgStatValue}>{uniqueRegisteredVolunteerCount}</Text>
          <Text style={styles.orgStatLabel}>Волонтёров</Text>
        </View>
      </View>

      {organizationEvents.length === 0 ? (
        <View style={styles.orgEmptyCard}>
          <Text style={styles.orgEmptyTitle}>Пока нет своих событий</Text>
          <Text style={styles.orgEmptyText}>
            Создайте первое событие, и здесь появится красивый dashboard с регистрациями, аватарками и навыками волонтёров.
          </Text>
        </View>
      ) : (
        organizationEvents.map((event) => {
          const registrations = registrationsByEventId.get(event.id) ?? [];

          return (
            <View key={event.id} style={styles.orgEventCard}>
              <View style={styles.orgEventHeader}>
                <View style={styles.orgEventCopy}>
                  <Text style={styles.orgEventTitle}>{event.title}</Text>
                  <Text style={styles.orgEventMeta}>
                    {[event.date, event.location].filter(Boolean).join(' • ') || 'Дата и место пока уточняются'}
                  </Text>
                </View>

                <View style={styles.orgCountPill}>
                  <Text style={styles.orgCountPillText}>{registrations.length}</Text>
                </View>
              </View>

              {registrations.length === 0 ? (
                <View style={styles.orgRegistrationsEmpty}>
                  <Text style={styles.orgRegistrationsEmptyText}>
                    Пока никто не записался. Как только волонтёры нажмут «Поучаствовать», они появятся здесь.
                  </Text>
                </View>
              ) : (
                registrations.map((registration) => (
                  <View key={registration.participationId} style={styles.registrationRow}>
                    {registration.volunteerAvatarUrl ? (
                      <Image
                        resizeMode="cover"
                        source={{ uri: registration.volunteerAvatarUrl }}
                        style={styles.registrationAvatar}
                      />
                    ) : (
                      <View style={styles.registrationAvatarPlaceholder}>
                        <Text style={styles.registrationAvatarInitials}>
                          {initialsFromName(registration.volunteerName)}
                        </Text>
                      </View>
                    )}

                    <View style={styles.registrationCopy}>
                      <Text style={styles.registrationName}>{registration.volunteerName}</Text>
                      {registration.volunteerHandle ? (
                        <Text style={styles.registrationHandle}>{registration.volunteerHandle}</Text>
                      ) : null}

                      <View style={styles.registrationSkillsWrap}>
                        {registration.skills.length > 0 ? (
                          registration.skills.slice(0, 3).map((skill) => (
                            <View key={`${registration.participationId}-${skill}`} style={styles.registrationSkillChip}>
                              <Text style={styles.registrationSkillText}>{skill}</Text>
                            </View>
                          ))
                        ) : (
                          <Text style={styles.registrationNoSkills}>Навыки пока не заполнены</Text>
                        )}
                      </View>
                    </View>

                    <Pressable
                      disabled={removingParticipationId === registration.participationId}
                      onPress={() => void handleRemoveVolunteer(registration.participationId)}
                      style={({ pressed }) => [
                        styles.removeVolunteerButton,
                        removingParticipationId === registration.participationId && styles.removeVolunteerButtonDisabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      {removingParticipationId === registration.participationId ? (
                        <ActivityIndicator color="#CF5064" size="small" />
                      ) : (
                        <Text style={styles.removeVolunteerButtonText}>Убрать</Text>
                      )}
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );

  const renderOrganizationEventHub = () => (
    <ScrollView contentContainerStyle={styles.profileScrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.headerBlock}>
        {renderTopBar()}

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.orgStatsRow}>
        <View style={styles.orgStatCard}>
          <Text style={styles.orgStatValue}>{organizationEvents.length}</Text>
          <Text style={styles.orgStatLabel}>Событий</Text>
        </View>
        <View style={styles.orgStatCard}>
          <Text style={styles.orgStatValue}>{organizationRegistrations.length}</Text>
          <Text style={styles.orgStatLabel}>Заявок</Text>
        </View>
        <View style={styles.orgStatCard}>
          <Text style={styles.orgStatValue}>{announcementsCount}</Text>
          <Text style={styles.orgStatLabel}>Сообщений</Text>
        </View>
      </View>

      {organizationEvents.length === 0 ? (
        <View style={styles.orgEmptyCard}>
          <Text style={styles.orgEmptyTitle}>Пока нет своих событий</Text>
          <Text style={styles.orgEmptyText}>
            Создайте первое событие, и здесь появятся таймер, список подавших и сообщения для участников.
          </Text>
        </View>
      ) : (
        organizationEvents.map((event) => {
          const registrations = registrationsByEventId.get(event.id) ?? [];
          const isExpanded = expandedOrganizationEventIds.includes(event.id);
          const eventDate = parseEventDate(event.date);
          const countdown = buildCountdownLabel(eventDate, now);

          return (
            <View key={event.id} style={styles.orgFeedCard}>
              <ImageBackground
                imageStyle={styles.orgFeedCardImage}
                source={{ uri: event.imageUrl || FALLBACK_EVENT_IMAGE }}
                style={styles.orgFeedCardImageWrap}
              >
                <View style={styles.orgFeedCardOverlay}>
                  <View style={styles.orgFeedCardTopRow}>
                    <View style={styles.orgImageBadge}>
                      <Text style={styles.orgImageBadgeText}>{registrations.length} заявок</Text>
                    </View>

                    <View
                      style={[
                        styles.orgTimerBadge,
                        countdown.tone === 'good' && styles.orgTimerBadgeGood,
                        countdown.tone === 'warning' && styles.orgTimerBadgeWarning,
                        countdown.tone === 'late' && styles.orgTimerBadgeLate,
                      ]}
                    >
                      <Text
                        style={[
                          styles.orgTimerBadgeText,
                          countdown.tone === 'late' && styles.orgTimerBadgeTextLate,
                        ]}
                      >
                        {countdown.shortLabel}
                      </Text>
                    </View>
                  </View>
                </View>
              </ImageBackground>

              <View style={styles.orgFeedCardBody}>
                <Text style={styles.orgEventTitle}>{event.title}</Text>
                <Text style={styles.orgEventMeta}>
                  {[event.date, event.location].filter(Boolean).join(' • ') || 'Дата и место пока уточняются'}
                </Text>

                <View
                  style={[
                    styles.orgCountdownCard,
                    countdown.tone === 'good' && styles.orgCountdownCardGood,
                    countdown.tone === 'warning' && styles.orgCountdownCardWarning,
                    countdown.tone === 'late' && styles.orgCountdownCardLate,
                  ]}
                >
                  <Text style={styles.orgCountdownLabel}>Таймер события</Text>
                  <Text style={styles.orgCountdownValue}>{countdown.label}</Text>
                </View>

                <View style={styles.orgEventActionRow}>
                  <Pressable
                    onPress={() => toggleOrganizationEvent(event.id)}
                    style={({ pressed }) => [styles.orgGhostButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.orgGhostButtonText}>
                      {isExpanded
                        ? 'Скрыть список'
                        : `Показать список подавших${registrations.length ? ` (${registrations.length})` : ''}`}
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={registrations.length === 0}
                    onPress={() => openAnnouncementComposer(event)}
                    style={({ pressed }) => [
                      styles.orgPrimaryAction,
                      registrations.length === 0 && styles.orgPrimaryActionDisabled,
                      pressed && registrations.length > 0 && styles.pressed,
                    ]}
                  >
                    <Text style={styles.orgPrimaryActionText}>
                      {registrations.length === 0 ? 'Нет участников' : 'Сообщение всем'}
                    </Text>
                  </Pressable>
                </View>

                {isExpanded ? (
                  registrations.length === 0 ? (
                    <View style={styles.orgRegistrationsEmpty}>
                      <Text style={styles.orgRegistrationsEmptyText}>
                        Пока никто не записался. Как только волонтёры нажмут «Поучаствовать», они появятся здесь.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.orgRegistrationsList}>
                      {registrations.map((registration) => {
                        const submittedAt = toMaybeDate(registration.createdAt);
                        const isOnTime =
                          eventDate && submittedAt ? submittedAt.getTime() <= eventDate.getTime() : null;

                        return (
                          <View key={registration.participationId} style={styles.registrationRow}>
                            {registration.volunteerAvatarUrl ? (
                              <Image
                                resizeMode="cover"
                                source={{ uri: registration.volunteerAvatarUrl }}
                                style={styles.registrationAvatar}
                              />
                            ) : (
                              <View style={styles.registrationAvatarPlaceholder}>
                                <Text style={styles.registrationAvatarInitials}>
                                  {initialsFromName(registration.volunteerName)}
                                </Text>
                              </View>
                            )}

                            <View style={styles.registrationCopy}>
                              <View style={styles.registrationHeadlineRow}>
                                <Text style={styles.registrationName}>{registration.volunteerName}</Text>
                                <View
                                  style={[
                                    styles.registrationStatusPill,
                                    isOnTime === true && styles.registrationStatusPillGood,
                                    isOnTime === false && styles.registrationStatusPillLate,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.registrationStatusText,
                                      isOnTime === true && styles.registrationStatusTextGood,
                                      isOnTime === false && styles.registrationStatusTextLate,
                                    ]}
                                  >
                                    {isOnTime === true ? 'Успел' : isOnTime === false ? 'Поздно' : 'Без дедлайна'}
                                  </Text>
                                </View>
                              </View>

                              {registration.volunteerHandle ? (
                                <Text style={styles.registrationHandle}>{registration.volunteerHandle}</Text>
                              ) : null}

                              <Text style={styles.registrationSubmittedAt}>
                                Подал: {formatDateTime(registration.createdAt)}
                              </Text>

                              <View style={styles.registrationSkillsWrap}>
                                {registration.skills.length > 0 ? (
                                  registration.skills.slice(0, 3).map((skill) => (
                                    <View key={`${registration.participationId}-${skill}`} style={styles.registrationSkillChip}>
                                      <Text style={styles.registrationSkillText}>{skill}</Text>
                                    </View>
                                  ))
                                ) : (
                                  <Text style={styles.registrationNoSkills}>Навыки пока не заполнены</Text>
                                )}
                              </View>
                            </View>

                            <Pressable
                              disabled={removingParticipationId === registration.participationId}
                              onPress={() => void handleRemoveVolunteer(registration.participationId)}
                              style={({ pressed }) => [
                                styles.removeVolunteerButton,
                                removingParticipationId === registration.participationId && styles.removeVolunteerButtonDisabled,
                                pressed && styles.pressed,
                              ]}
                            >
                              {removingParticipationId === registration.participationId ? (
                                <ActivityIndicator color="#CF5064" size="small" />
                              ) : (
                                <Text style={styles.removeVolunteerButtonText}>Убрать</Text>
                              )}
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  )
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );

  const renderOrganizationNotificationContent = () => {
    if (organizationNotifications.length === 0 && organizationAnnouncements.length === 0) {
      return (
        <View style={styles.messageEmptyCard}>
          <Text style={styles.messageEmptyTitle}>Пока нет уведомлений</Text>
          <Text style={styles.messageEmptyText}>
            Как только волонтёр запишется на ваше событие или вы отправите рассылку, это появится здесь.
          </Text>
        </View>
      );
    }

    return (
      <>
        {organizationNotifications.length > 0 ? (
          <>
            <Text style={styles.messageSectionTitle}>Новые записи</Text>
            {organizationNotifications.map((notification) => (
              <View key={notification.id} style={styles.messageCard}>
                <View style={styles.messageVolunteerRow}>
                  {notification.volunteerAvatarUrl ? (
                    <Image
                      resizeMode="cover"
                      source={{ uri: notification.volunteerAvatarUrl }}
                      style={styles.messageVolunteerAvatar}
                    />
                  ) : (
                    <View style={styles.messageVolunteerAvatarPlaceholder}>
                      <Text style={styles.messageVolunteerAvatarInitials}>
                        {initialsFromName(notification.volunteerName)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.messageVolunteerCopy}>
                    <View style={styles.messageCardTopRow}>
                      <View style={styles.messageCardEventBadge}>
                        <Text style={styles.messageCardEventBadgeText}>{notification.eventTitle}</Text>
                      </View>
                      <Text style={styles.messageCardDate}>{formatDateTime(notification.createdAt)}</Text>
                    </View>

                    <Text style={styles.messageCardTitle}>{notification.volunteerName} записался на событие</Text>
                    {notification.volunteerHandle ? (
                      <Text style={styles.messageVolunteerHandle}>{notification.volunteerHandle}</Text>
                    ) : null}
                    <Text style={styles.messageCardBody}>
                      У вас новый участник. Проверьте список подавших и при необходимости свяжитесь с ним.
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {organizationAnnouncements.length > 0 ? (
          <>
            <Text style={styles.messageSectionTitle}>История рассылок</Text>
            {organizationAnnouncements.map((announcement) => (
              <View key={announcement.id} style={styles.messageCard}>
                <View style={styles.messageCardTopRow}>
                  <View style={styles.messageCardEventBadge}>
                    <Text style={styles.messageCardEventBadgeText}>{announcement.eventTitle}</Text>
                  </View>
                  <Text style={styles.messageCardDate}>{formatDateTime(announcement.createdAt)}</Text>
                </View>

                <Text style={styles.messageCardTitle}>{announcement.title}</Text>
                <Text style={styles.messageCardBody}>{announcement.message}</Text>

                <View style={styles.messageCardFooter}>
                  <Text style={styles.messageCardFooterText}>Получателей: {announcement.recipientCount}</Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </>
    );
  };

  const renderVolunteerNotificationContent = () => {
    if (volunteerNotifications.length === 0) {
      return (
        <View style={styles.messageEmptyCard}>
          <Text style={styles.messageEmptyTitle}>Пока нет уведомлений</Text>
          <Text style={styles.messageEmptyText}>
            Когда организация отправит сообщение участникам события, оно появится здесь.
          </Text>
        </View>
      );
    }

    return (
      <>
        {volunteerNotifications.map((notification) => (
          <View key={notification.id} style={styles.messageCard}>
            <View style={styles.messageCardTopRow}>
              <View style={styles.messageCardEventBadge}>
                <Text style={styles.messageCardEventBadgeText}>{notification.eventTitle}</Text>
              </View>
              <Text style={styles.messageCardDate}>{formatDateTime(notification.createdAt)}</Text>
            </View>

            <Text style={styles.messageCardTitle}>{notification.title}</Text>
            <Text style={styles.messageCardBody}>{notification.message}</Text>

            <View style={styles.messageCardFooter}>
              <Text style={styles.messageCardFooterText}>Сообщение от организации по вашему ивенту</Text>
            </View>
          </View>
        ))}
      </>
    );
  };

  const renderAnnouncementCenter = () => (
    <Modal
      animationType="fade"
      onRequestClose={() => setShowAnnouncementCenter(false)}
      transparent
      visible={showAnnouncementCenter}
    >
      <View style={styles.overlay}>
        <Pressable onPress={() => setShowAnnouncementCenter(false)} style={StyleSheet.absoluteFillObject} />

        <View style={styles.messageSheet}>
          <View style={styles.messageSheetHandle} />

          <View style={styles.messageSheetHeader}>
            <Text style={styles.messageSheetTitle}>
              {currentUserRole === 'organization' ? 'Сообщения' : 'Уведомления'}
            </Text>
            <Pressable
              onPress={() => setShowAnnouncementCenter(false)}
              style={({ pressed }) => [styles.messageSheetClose, pressed && styles.pressed]}
            >
              <Text style={styles.messageSheetCloseText}>Закрыть</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {currentUserRole === 'organization'
              ? renderOrganizationNotificationContent()
              : renderVolunteerNotificationContent()}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderMenuDrawer = () => (
    <Modal
      animationType="fade"
      onRequestClose={() => setShowMenuDrawer(false)}
      transparent
      visible={showMenuDrawer}
    >
      <View style={styles.menuDrawerOverlay}>
        <Pressable
          onPress={() => setShowMenuDrawer(false)}
          style={styles.menuDrawerBackdrop}
        />

        <View style={styles.menuDrawerPanel}>
          <View style={styles.menuDrawerHandle} />
          <Text style={styles.menuDrawerTitle}>Меню</Text>
          <Text style={styles.menuDrawerSubtitle}>Здесь только быстрый выход из аккаунта.</Text>

          <Pressable
            disabled={isLoggingOut}
            onPress={() => void handleLogout()}
            style={({ pressed }) => [
              styles.menuDrawerLogoutButton,
              isLoggingOut && styles.menuDrawerLogoutButtonDisabled,
              pressed && !isLoggingOut && styles.pressed,
            ]}
          >
            {isLoggingOut ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.menuDrawerLogoutText}>Выйти из аккаунта</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const renderAiQuestionModal = () => (
    <Modal
      animationType="fade"
      onRequestClose={() => setShowAiQuestionModal(false)}
      transparent
      visible={showAiQuestionModal}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 0}
        style={styles.overlay}
      >
        <Pressable onPress={() => setShowAiQuestionModal(false)} style={StyleSheet.absoluteFillObject} />

        <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
          <View style={styles.aiSheet}>
            <View style={styles.messageSheetHandle} />

            <View style={styles.aiSheetHeader}>
              <View style={styles.aiSheetHeaderCopy}>
                <Text style={styles.aiSheetTitle}>AI по событию</Text>
                <Text style={styles.aiSheetSubtitle}>
                  {selectedAiEvent?.title || 'Задайте вопрос по выбранному событию'}
                </Text>
              </View>

              <Pressable
                onPress={() => setShowAiQuestionModal(false)}
                style={({ pressed }) => [styles.messageSheetClose, pressed && styles.pressed]}
              >
                <Text style={styles.messageSheetCloseText}>Закрыть</Text>
              </Pressable>
            </View>

            <ScrollView
              ref={aiModalScrollRef}
              contentContainerStyle={styles.aiSheetScrollContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.aiQuestionCard}>
                <Text style={styles.aiQuestionLabel}>Ваш вопрос</Text>
                <TextInput
                  multiline
                  onChangeText={setAiQuestion}
                  placeholder="Например: нужно ли приносить свои перчатки или как проходит регистрация?"
                  placeholderTextColor="#94A0BC"
                  style={styles.aiQuestionInput}
                  textAlignVertical="top"
                  value={aiQuestion}
                />

                {aiAnswerError ? (
                  <View style={styles.aiAnswerErrorBanner}>
                    <Text style={styles.aiAnswerErrorText}>{aiAnswerError}</Text>
                  </View>
                ) : null}

                <Pressable
                  disabled={isAiAnswering}
                  onPress={() => void handleAskEventQuestion()}
                  style={({ pressed }) => [
                    styles.aiAskButton,
                    isAiAnswering && styles.aiAskButtonDisabled,
                    pressed && !isAiAnswering && styles.pressed,
                  ]}
                >
                  {isAiAnswering ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.aiAskButtonText}>Спросить AI</Text>
                  )}
                </Pressable>
              </View>

              <View style={[styles.aiAnswerCard, aiAnswerHighlighted && styles.aiAnswerCardHighlighted]}>
                {aiAnswer ? (
                  <View style={styles.aiAnswerBadge}>
                    <Text style={styles.aiAnswerBadgeText}>Новый ответ AI</Text>
                  </View>
                ) : null}
                <Text style={styles.aiAnswerTitle}>Ответ</Text>
                {isAiAnswering ? (
                  <View style={styles.aiAnswerLoadingRow}>
                    <ActivityIndicator color="#3650E8" size="small" />
                    <Text style={styles.aiAnswerLoadingText}>AI готовит ответ...</Text>
                  </View>
                ) : (
                  <Text style={styles.aiAnswerBody}>
                    {displayedAiAnswer ||
                      'AI ответит только на основе данных выбранного события. Если информации нет, он честно сообщит об этом.'}
                  </Text>
                )}
              </View>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderMatchDeck = () => (
    <ScrollView contentContainerStyle={styles.matchDeckContent} showsVerticalScrollIndicator={false}>
      {renderPlainHeader()}

      {recommendedEvents.length === 0 ? (
        renderEmptyState()
      ) : currentMatchEvent ? (
        <>
          {renderEventCard({ item: currentMatchEvent })}

          <View style={styles.matchDecisionRow}>
            <Pressable
              disabled={matchDecisionLoadingId === currentMatchEvent.id}
              onPress={() => void handleMatchDecision(currentMatchEvent, 'dislike')}
              style={({ pressed }) => [
                styles.matchDecisionButton,
                styles.matchDecisionDismissButton,
                matchDecisionLoadingId === currentMatchEvent.id && styles.matchDecisionButtonDisabled,
                pressed && matchDecisionLoadingId !== currentMatchEvent.id && styles.pressed,
              ]}
            >
              <Text style={styles.matchDecisionDismissText}>Не нрав</Text>
            </Pressable>

            <Pressable
              disabled={matchDecisionLoadingId === currentMatchEvent.id}
              onPress={() => void handleMatchDecision(currentMatchEvent, 'like')}
              style={({ pressed }) => [
                styles.matchDecisionButton,
                styles.matchDecisionLikeButton,
                matchDecisionLoadingId === currentMatchEvent.id && styles.matchDecisionButtonDisabled,
                pressed && matchDecisionLoadingId !== currentMatchEvent.id && styles.pressed,
              ]}
            >
              {matchDecisionLoadingId === currentMatchEvent.id ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.matchDecisionLikeText}>Нрав</Text>
              )}
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.matchDoneCard}>
          <Text style={styles.matchDoneTitle}>Все объявления просмотрены</Text>
          <Text style={styles.matchDoneText}>
            Лайкнутые события уже лежат в `Сохран.`. Можно начать подборку заново или вернуться к ленте.
          </Text>

          <Pressable
            onPress={resetMatchDeck}
            style={({ pressed }) => [styles.matchRestartButton, pressed && styles.pressed]}
          >
            <Text style={styles.matchRestartButtonText}>Показать заново</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );

  const activeFeedData =
    activeTab === 'home' ? filteredEvents : activeTab === 'match' ? recommendedEvents : savedEvents;

  const activeHeader =
    activeTab === 'home'
      ? renderHomeHeader()
      : activeTab === 'match'
        ? renderSectionHeader('Матч', 'Здесь собираются рекомендованные и популярные события для быстрого выбора.')
        : renderSectionHeader('Сохранённое', 'Ваши отмеченные события всегда под рукой.');

  const resolvedHeader = activeTab === 'saved' ? renderPlainHeader() : activeHeader;
  const showOrganizationEventsTab = currentUserRole === 'organization' && activeTab === 'saved';
  const profileScreenContent =
    currentUserRole === 'organization' ? (
      <OrganizationProfileScreen
        embedded
        onOpenEventsHub={() => setActiveTab('saved')}
        onOpenMenu={handleOpenMenu}
        onOpenNotifications={() => void openNotificationCenter()}
      />
    ) : (
      renderProfileTab()
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {activeTab === 'profile' ? (
          <View style={styles.profileContainer}>{profileScreenContent}</View>
        ) : showOrganizationEventsTab ? (
          <View style={styles.profileContainer}>{renderOrganizationEventHub()}</View>
        ) : currentUserRole === 'volunteer' && activeTab === 'match' ? (
          <View style={styles.profileContainer}>{renderMatchDeck()}</View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={activeFeedData}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={renderEmptyState()}
            ListHeaderComponent={resolvedHeader}
            renderItem={renderEventCard}
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={styles.bottomBar}>
          {resolvedTabs.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => setActiveTab(item.key)}
              style={({ pressed }) => [styles.bottomTab, pressed && styles.pressed]}
            >
              <Image
                resizeMode="contain"
                source={item.icon}
                style={[
                  styles.bottomTabIconImage,
                  activeTab !== item.key && styles.bottomTabIconImageInactive,
                ]}
              />
              <Text
                numberOfLines={1}
                style={[styles.bottomTabLabel, activeTab === item.key && styles.bottomTabLabelActive]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {currentUserRole === 'organization' && activeTab === 'home' ? (
          <Pressable
            onPress={openCreateFlow}
            style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          >
            <Text style={styles.fabIcon}>＋</Text>
          </Pressable>
        ) : null}
      </View>

      {renderMenuDrawer()}
      {renderAnnouncementCenter()}
      {renderAiQuestionModal()}

      <Modal
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
        presentationStyle="fullScreen"
        visible={showCreateModal}
      >
        <CreateEventScreen
          currentUserRole={currentUserRole}
          onClose={() => setShowCreateModal(false)}
          onPublished={() => setShowCreateModal(false)}
        />
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setShowAnnouncementComposer(false)}
        presentationStyle="fullScreen"
        visible={showAnnouncementComposer && Boolean(selectedAnnouncementEvent)}
      >
        {selectedAnnouncementEvent ? (
          <CreateAnnouncementScreen
            event={selectedAnnouncementEvent}
            recipientCount={(registrationsByEventId.get(selectedAnnouncementEvent.id) ?? []).length}
            onClose={() => setShowAnnouncementComposer(false)}
            onPublished={() => {
              setShowAnnouncementComposer(false);
              setShowAnnouncementCenter(true);
            }}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F6F2',
  },
  container: {
    flex: 1,
    backgroundColor: '#F6F6F2',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 140,
  },
  matchDeckContent: {
    paddingHorizontal: 20,
    paddingBottom: 140,
  },
  matchDeckHeaderCard: {
    borderRadius: 28,
    backgroundColor: '#ECECE7',
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 18,
  },
  matchDeckProgressPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#E6EBFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 12,
  },
  matchDeckProgressText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#3650DE',
  },
  matchDeckTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 6,
  },
  matchDeckSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#69708C',
  },
  matchDecisionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  matchDecisionButton: {
    width: '48.5%',
    minHeight: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchDecisionDismissButton: {
    backgroundColor: '#F2EDEF',
  },
  matchDecisionLikeButton: {
    backgroundColor: '#2B45D8',
  },
  matchDecisionButtonDisabled: {
    opacity: 0.75,
  },
  matchDecisionDismissText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#B04A60',
  },
  matchDecisionLikeText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  matchDoneCard: {
    borderRadius: 28,
    backgroundColor: '#F1F1ED',
    paddingHorizontal: 22,
    paddingVertical: 24,
  },
  matchDoneTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 8,
  },
  matchDoneText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#66708C',
    marginBottom: 18,
  },
  matchRestartButton: {
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2B45D8',
  },
  matchRestartButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerBlock: {
    paddingTop: 8,
    marginBottom: 18,
  },
  sectionIntro: {
    borderRadius: 28,
    backgroundColor: '#ECECE7',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  sectionTitle: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#69708C',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  logo: {
    fontSize: 34,
    fontWeight: '800',
    color: '#0F1430',
    fontStyle: 'italic',
    letterSpacing: 0.8,
  },
  headerActions: {
    flexDirection: 'row',
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    position: 'relative',
    shadowColor: '#2A336B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 999,
    backgroundColor: '#F04A63',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  searchGlyph: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCircle: {
    width: 16,
    height: 16,
    borderWidth: 3,
    borderColor: '#8B92AD',
    borderRadius: 8,
  },
  searchHandle: {
    position: 'absolute',
    width: 10,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#8B92AD',
    right: 1,
    bottom: 4,
    transform: [{ rotate: '45deg' }],
  },
  notificationIconImage: {
    width: 24,
    height: 24,
  },
  menuIcon: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLine: {
    width: 18,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#242C3E',
    marginVertical: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: '#E9E9E4',
    paddingHorizontal: 16,
    minHeight: 58,
    marginBottom: 18,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 15,
    color: '#12172F',
  },
  categoriesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 4,
    marginBottom: 4,
  },
  categoryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    opacity: 0.62,
  },
  categoryButtonSelected: {
    opacity: 1,
  },
  categoryIconImage: {
    width: 52,
    height: 52,
    marginBottom: 10,
  },
  categoryLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    color: '#11183A',
    textAlign: 'center',
    maxWidth: 70,
  },
  categoryLabelSelected: {
    color: '#243BD7',
  },
  errorBanner: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(196, 56, 76, 0.16)',
    backgroundColor: '#FFF1F3',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#B3374E',
    fontWeight: '600',
  },
  card: {
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#F1F1ED',
    marginBottom: 18,
    shadowColor: '#1D2552',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
  },
  cardImageWrap: {
    height: 220,
    justifyContent: 'space-between',
  },
  cardImage: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  cardImageOverlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: 'rgba(20, 24, 46, 0.16)',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flex: 1,
    marginRight: 12,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  popularBadge: {
    backgroundColor: 'rgba(255, 245, 234, 0.96)',
  },
  recommendedBadge: {
    backgroundColor: 'rgba(236, 242, 255, 0.96)',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#18214A',
  },
  saveButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(246, 246, 242, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonActive: {
    backgroundColor: '#FFF1F4',
  },
  saveIcon: {
    fontSize: 18,
    color: '#15203F',
  },
  saveIconActive: {
    color: '#F04A63',
  },
  cardBody: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 20,
  },
  cardTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 12,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  tagPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    marginRight: 8,
    marginBottom: 8,
  },
  tagPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3852E0',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 18,
    marginBottom: 10,
  },
  metaIcon: {
    fontSize: 13,
  },
  metaText: {
    marginLeft: 8,
    fontSize: 13,
    color: '#666E8F',
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: '#4F5677',
    marginTop: 2,
  },
  matchCard: {
    marginTop: 14,
    borderRadius: 20,
    backgroundColor: '#EEF3FF',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  matchScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  matchScoreLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5162B3',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  matchScoreValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2039CB',
  },
  matchLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchLoadingText: {
    marginLeft: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#506081',
    fontWeight: '600',
  },
  matchExplanationText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#425071',
    fontWeight: '600',
  },
  matchExplanationError: {
    fontSize: 13,
    lineHeight: 19,
    color: '#B3425B',
    fontWeight: '700',
  },
  matchExplanationPlaceholder: {
    fontSize: 13,
    lineHeight: 19,
    color: '#667396',
  },
  aiQuestionButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginTop: 14,
    backgroundColor: '#F1F5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiQuestionButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3550E5',
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  joinStatusPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ECECEC',
  },
  joinStatusPillActive: {
    backgroundColor: '#E7F6EC',
  },
  joinStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#66708C',
  },
  joinStatusTextActive: {
    color: '#2E7E54',
  },
  joinButton: {
    minHeight: 44,
    minWidth: 138,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: '#131B3D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonActive: {
    backgroundColor: '#4EBC7E',
  },
  joinButtonDisabled: {
    opacity: 0.9,
  },
  joinButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 42,
    backgroundColor: '#F1F1ED',
    borderRadius: 28,
  },
  emptyIconWrap: {
    width: 70,
    height: 70,
    borderRadius: 24,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyEmoji: {
    fontSize: 30,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#141A32',
    marginTop: 14,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#6A708E',
    textAlign: 'center',
  },
  profileContainer: {
    flex: 1,
  },
  profileScreen: {
    flex: 1,
  },
  profileScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 140,
  },
  profileCard: {
    borderRadius: 30,
    backgroundColor: '#F1F1ED',
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  profileIcon: {
    width: 72,
    height: 72,
    marginBottom: 14,
  },
  profileRoleLabel: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#E7EBFF',
    color: '#3144D1',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 12,
  },
  profileHeadline: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    color: '#11183A',
    textAlign: 'center',
    marginBottom: 10,
  },
  profileDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: '#606887',
    textAlign: 'center',
  },
  profileStatsRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 20,
  },
  profileStatCard: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: '#E8E8E1',
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  profileStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 4,
  },
  profileStatLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#707796',
  },
  profileHintCard: {
    borderRadius: 26,
    backgroundColor: '#ECECE7',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  profileHintTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#151C36',
    marginBottom: 8,
  },
  profileHintText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#68708E',
  },
  orgHeroCard: {
    borderRadius: 30,
    backgroundColor: '#F1F1ED',
    paddingHorizontal: 22,
    paddingVertical: 22,
    marginBottom: 16,
  },
  orgHeroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E7EBFF',
    marginBottom: 12,
  },
  orgHeroBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#3144D1',
  },
  orgHeroTitle: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 10,
  },
  orgHeroDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: '#626A89',
    marginBottom: 18,
  },
  orgHeroButton: {
    alignSelf: 'flex-start',
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: '#11183A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgHeroButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  orgStatsRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  orgStatCard: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: '#ECECE7',
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  orgStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 4,
  },
  orgStatLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#707796',
    textAlign: 'center',
  },
  orgEmptyCard: {
    borderRadius: 28,
    backgroundColor: '#ECECE7',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  orgEmptyTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#151C36',
    marginBottom: 8,
  },
  orgEmptyText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#68708E',
  },
  orgFeedCard: {
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#F1F1ED',
    marginBottom: 18,
    shadowColor: '#1D2552',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
  },
  orgFeedCardImageWrap: {
    height: 214,
  },
  orgFeedCardImage: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  orgFeedCardOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(15, 19, 47, 0.18)',
  },
  orgFeedCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orgImageBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  orgImageBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#17214B',
  },
  orgTimerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(236, 242, 255, 0.96)',
  },
  orgTimerBadgeGood: {
    backgroundColor: 'rgba(230, 246, 236, 0.96)',
  },
  orgTimerBadgeWarning: {
    backgroundColor: 'rgba(255, 244, 224, 0.97)',
  },
  orgTimerBadgeLate: {
    backgroundColor: 'rgba(255, 234, 238, 0.97)',
  },
  orgTimerBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2740D7',
  },
  orgTimerBadgeTextLate: {
    color: '#C94D61',
  },
  orgFeedCardBody: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  orgCountdownCard: {
    borderRadius: 22,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 14,
    marginBottom: 14,
  },
  orgCountdownCardGood: {
    backgroundColor: '#E8F7EE',
  },
  orgCountdownCardWarning: {
    backgroundColor: '#FFF4E3',
  },
  orgCountdownCardLate: {
    backgroundColor: '#FFF0F3',
  },
  orgCountdownLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#56628F',
    marginBottom: 6,
  },
  orgCountdownValue: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: '#12182F',
  },
  orgEventActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  orgGhostButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCE2F0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginRight: 10,
  },
  orgGhostButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2336A7',
    textAlign: 'center',
  },
  orgPrimaryAction: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: '#11183A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  orgPrimaryActionDisabled: {
    backgroundColor: '#C9CEDB',
  },
  orgPrimaryActionText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  orgRegistrationsList: {
    marginTop: 2,
  },
  orgEventCard: {
    borderRadius: 28,
    backgroundColor: '#F1F1ED',
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 16,
  },
  orgEventHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  orgEventCopy: {
    flex: 1,
    paddingRight: 12,
  },
  orgEventTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    color: '#141A32',
    marginBottom: 6,
  },
  orgEventMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7391',
    fontWeight: '600',
  },
  orgCountPill: {
    minWidth: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E7EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgCountPillText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3144D1',
  },
  orgRegistrationsEmpty: {
    borderRadius: 20,
    backgroundColor: '#E7E7E1',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  orgRegistrationsEmptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#68708E',
  },
  registrationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  registrationAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  registrationAvatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: '#DCE5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  registrationAvatarInitials: {
    fontSize: 18,
    fontWeight: '800',
    color: '#3A53D8',
  },
  registrationCopy: {
    flex: 1,
    paddingRight: 10,
  },
  registrationName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#12182F',
    marginBottom: 3,
  },
  registrationHandle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7B82A0',
    marginBottom: 8,
  },
  registrationHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  registrationStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#ECECEC',
    marginLeft: 10,
  },
  registrationStatusPillGood: {
    backgroundColor: '#E7F6EC',
  },
  registrationStatusPillLate: {
    backgroundColor: '#FFF0F3',
  },
  registrationStatusText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#76809C',
  },
  registrationStatusTextGood: {
    color: '#2E7E54',
  },
  registrationStatusTextLate: {
    color: '#CF5064',
  },
  registrationSubmittedAt: {
    fontSize: 12,
    color: '#6C7391',
    fontWeight: '600',
    marginBottom: 8,
  },
  registrationSkillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  registrationSkillChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    marginRight: 8,
    marginBottom: 6,
  },
  registrationSkillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3852E0',
  },
  registrationNoSkills: {
    fontSize: 12,
    color: '#78809C',
    fontWeight: '600',
  },
  removeVolunteerButton: {
    minWidth: 86,
    minHeight: 38,
    borderRadius: 14,
    backgroundColor: '#FFF1F3',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  removeVolunteerButtonDisabled: {
    opacity: 0.7,
  },
  removeVolunteerButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#CF5064',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(18, 24, 47, 0.28)',
    justifyContent: 'flex-end',
  },
  menuDrawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18, 24, 47, 0.24)',
    justifyContent: 'flex-end',
    flexDirection: 'row',
  },
  menuDrawerBackdrop: {
    flex: 1,
  },
  menuDrawerPanel: {
    width: '76%',
    maxWidth: 340,
    backgroundColor: '#FBFBF8',
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 34,
    shadowColor: '#1C244F',
    shadowOffset: { width: -8, height: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 14,
  },
  menuDrawerHandle: {
    width: 54,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#D8DBE8',
    alignSelf: 'center',
    marginBottom: 24,
  },
  menuDrawerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#141A32',
    marginBottom: 8,
  },
  menuDrawerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6A738F',
    marginBottom: 24,
  },
  menuDrawerLogoutButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: '#1F2E8E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  menuDrawerLogoutButtonDisabled: {
    opacity: 0.76,
  },
  menuDrawerLogoutText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  messageSheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: '#FBFBF8',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '78%',
  },
  aiSheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: '#FBFBF8',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '82%',
  },
  messageSheetHandle: {
    width: 56,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#D8DBE8',
    alignSelf: 'center',
    marginBottom: 16,
  },
  messageSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  messageSheetTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#141A32',
  },
  messageSheetClose: {
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageSheetCloseText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3144D1',
  },
  aiSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  aiSheetHeaderCopy: {
    flex: 1,
    paddingRight: 12,
  },
  aiSheetTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#141A32',
    marginBottom: 6,
  },
  aiSheetSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#67708E',
  },
  aiSheetScrollContent: {
    paddingBottom: 24,
  },
  aiQuestionCard: {
    borderRadius: 24,
    backgroundColor: '#F1F5FF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 14,
  },
  aiQuestionLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1C2758',
    marginBottom: 10,
  },
  aiQuestionInput: {
    minHeight: 116,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    lineHeight: 21,
    color: '#141A32',
    marginBottom: 12,
  },
  aiAnswerErrorBanner: {
    borderRadius: 16,
    backgroundColor: '#FFF1F4',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  aiAnswerErrorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#B8425B',
    fontWeight: '700',
  },
  aiAskButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#2B45D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiAskButtonDisabled: {
    opacity: 0.75,
  },
  aiAskButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  aiAnswerCard: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  aiAnswerCardHighlighted: {
    borderWidth: 1,
    borderColor: '#DCE4FF',
    backgroundColor: '#F7F9FF',
    shadowColor: '#3249D6',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },
  aiAnswerBadge: {
    alignSelf: 'flex-start',
    marginBottom: 10,
    borderRadius: 999,
    backgroundColor: '#E9EEFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  aiAnswerBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#3450DE',
  },
  aiAnswerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#141A32',
    marginBottom: 10,
  },
  aiAnswerLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiAnswerLoadingText: {
    marginLeft: 8,
    fontSize: 14,
    lineHeight: 21,
    color: '#425071',
    fontWeight: '700',
  },
  aiAnswerBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#56617F',
  },
  messageEmptyCard: {
    borderRadius: 24,
    backgroundColor: '#F1F1ED',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  messageEmptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#141A32',
    marginBottom: 8,
  },
  messageEmptyText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#68708E',
  },
  messageSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6F79B2',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  messageCard: {
    borderRadius: 24,
    backgroundColor: '#F1F1ED',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  messageCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  messageCardEventBadge: {
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E7EBFF',
    marginRight: 12,
  },
  messageCardEventBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3144D1',
  },
  messageCardDate: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7A819D',
  },
  messageCardTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    color: '#141A32',
    marginBottom: 8,
  },
  messageCardBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#556081',
  },
  messageVolunteerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  messageVolunteerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  messageVolunteerAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    backgroundColor: '#DCE5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageVolunteerAvatarInitials: {
    fontSize: 17,
    fontWeight: '800',
    color: '#3A53D8',
  },
  messageVolunteerCopy: {
    flex: 1,
  },
  messageVolunteerHandle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7B82A0',
    marginBottom: 6,
  },
  messageCardFooter: {
    marginTop: 12,
  },
  messageCardFooterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6E7695',
  },
  bottomBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    borderRadius: 28,
    backgroundColor: '#FBFBF8',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 58, 0.06)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 10,
    shadowColor: '#161D33',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 16,
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 58,
  },
  bottomTabIconImage: {
    width: 34,
    height: 34,
    marginBottom: 6,
  },
  bottomTabIconImageInactive: {
    opacity: 0.62,
  },
  bottomTabLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7A819D',
    textAlign: 'center',
    maxWidth: 72,
    minHeight: 14,
  },
  bottomTabLabelActive: {
    color: '#E17882',
  },
  fab: {
    position: 'absolute',
    right: 26,
    bottom: 108,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#10183A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10183A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 28,
    color: '#FFFFFF',
    marginTop: -2,
  },
  pressed: {
    opacity: 0.9,
  },
});
