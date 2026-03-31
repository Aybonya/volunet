import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getCurrentUser } from '../services/authService';
import {
  EMPTY_ORGANIZATION_STATS,
  createDefaultOrganizationProfileIfMissing,
  subscribeToOrganizationDashboard,
  subscribeToOrganizationProfile,
  updateOrganizationProfile,
} from '../services/organizationProfileService';
import {
  analyzeOrganizationProfile,
  draftOrganizationTask,
  improveEventDescription,
  suggestNeededSkills,
} from '../services/openaiService';
import { uploadOrganizationAvatar } from '../services/storageService';
import {
  OrganizationAiAnswerMap,
  OrganizationDashboardData,
  OrganizationEventPreviewItem,
  OrganizationProfileData,
  OrganizationStats,
} from '../types/organization';

type Props = {
  embedded?: boolean;
  onOpenNotifications?: () => void;
  onOpenMenu?: () => void;
  onOpenEventsHub?: () => void;
};

type OrganizationProfileForm = {
  organizationName: string;
  contactPerson: string;
  location: string;
  organizationType: string;
  tagline: string;
  focusAreas: string[];
  description: string;
};

type AiActionKey =
  | 'create-task'
  | 'improve-event-description'
  | 'suggest-skills'
  | 'profile-gaps';

type OrganizationAiQuestion = {
  id: string;
  question: string;
  options: string[];
};

const ASSETS = {
  bell: require('../assets/icons/categories/bell-cutout.png'),
};

const DEFAULT_DASHBOARD: OrganizationDashboardData = {
  stats: EMPTY_ORGANIZATION_STATS,
  latestEvents: [],
};

const FOCUS_AREA_OPTIONS = [
  'Environment',
  'Education',
  'Community',
  'Health',
  'Social care',
  'Animals',
  'IT',
  'Design',
];

const AI_ACTIONS: Array<{ key: AiActionKey; title: string; caption: string }> = [
  {
    key: 'create-task',
    title: 'Сформулировать новую задачу',
    caption: 'Из сырой идеи в аккуратный бриф.',
  },
  {
    key: 'improve-event-description',
    title: 'Улучшить описание события',
    caption: 'Сделать карточку события яснее и сильнее.',
  },
  {
    key: 'suggest-skills',
    title: 'Подсказать нужные навыки',
    caption: 'Подобрать качества и роли для волонтёров.',
  },
  {
    key: 'profile-gaps',
    title: 'Показать слабые места профиля',
    caption: 'Что стоит заполнить, чтобы вызывать больше доверия.',
  },
];

const ORGANIZATION_AI_QUESTIONS: OrganizationAiQuestion[] = [
  {
    id: 'mission-style',
    question: 'Какой стиль помощи для вас самый важный?',
    options: ['Разовые акции', 'Долгие программы', 'Смешанный формат'],
  },
  {
    id: 'volunteer-tone',
    question: 'Каких волонтёров вам проще всего вовлекать?',
    options: ['Самостоятельных', 'Командных', 'Тех, кому нужен чёткий план'],
  },
  {
    id: 'coordination-level',
    question: 'Насколько подробно вы обычно инструктируете участников?',
    options: ['Очень подробно', 'Даю основу и свободу', 'Зависит от задачи'],
  },
  {
    id: 'task-rhythm',
    question: 'Какие задачи у вас появляются чаще всего?',
    options: ['Оффлайн помощь', 'Коммуникации и медиа', 'Организация и координация'],
  },
  {
    id: 'trust-signal',
    question: 'Что сильнее всего помогает волонтёру довериться вам?',
    options: ['Прозрачное описание', 'Понятный контактный человек', 'Отзывы и результаты'],
  },
];

const buildInitialForm = (profile?: OrganizationProfileData | null): OrganizationProfileForm => ({
  organizationName: profile?.organizationName ?? '',
  contactPerson: profile?.contactPerson ?? '',
  location: profile?.location ?? '',
  organizationType: profile?.organizationType ?? '',
  tagline: profile?.tagline ?? '',
  focusAreas: profile?.focusAreas ?? [],
  description: profile?.description ?? '',
});

const buildInitialAiAnswers = (profile?: OrganizationProfileData | null): OrganizationAiAnswerMap =>
  profile?.aiQuestionnaireAnswers ?? {};

const initialsFromName = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (parts.length === 0) {
    return 'VO';
  }

  return parts.map((item) => item[0]?.toUpperCase() ?? '').join('') || 'VO';
};

const calculateProfileCompletion = (profile: OrganizationProfileData) => {
  const checkpoints = [
    Boolean(profile.organizationName.trim()),
    Boolean(profile.tagline.trim()),
    Boolean(profile.location.trim()),
    Boolean(profile.organizationType.trim()),
    Boolean(profile.description.trim()),
    profile.focusAreas.length > 0,
    Boolean(profile.avatarUrl),
  ];

  return Math.round((checkpoints.filter(Boolean).length / checkpoints.length) * 100);
};

const formatEventStatus = (status: OrganizationEventPreviewItem['status']) =>
  status === 'active' ? 'Active' : 'Completed';

const HeaderIconButton = ({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress?: () => void;
}) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
    {children}
  </Pressable>
);

const MenuIcon = () => (
  <View style={styles.menuGlyph}>
    <View style={styles.menuLine} />
    <View style={styles.menuLine} />
    <View style={styles.menuLine} />
  </View>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value || '—'}</Text>
  </View>
);

const EditableField = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) => (
  <View style={styles.fieldBlock}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      multiline={multiline}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#A0A6BD"
      style={[styles.input, multiline && styles.inputMultiline]}
      textAlignVertical={multiline ? 'top' : 'center'}
      value={value}
    />
  </View>
);

const FocusAreaChip = ({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) => (
  <Pressable
    disabled={!onPress}
    onPress={onPress}
    style={({ pressed }) => [
      styles.focusChip,
      selected && styles.focusChipSelected,
      pressed && onPress && styles.pressed,
    ]}
  >
    <Text style={[styles.focusChipText, selected && styles.focusChipTextSelected]}>{label}</Text>
  </Pressable>
);

const StatCard = ({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: 'blue' | 'mint' | 'peach' | 'lavender';
}) => (
  <View
    style={[
      styles.statCard,
      tint === 'blue'
        ? styles.statCardBlue
        : tint === 'mint'
          ? styles.statCardMint
          : tint === 'peach'
            ? styles.statCardPeach
            : styles.statCardLavender,
    ]}
  >
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const EventPreviewCard = ({
  item,
  onPressSeeAll,
}: {
  item: OrganizationEventPreviewItem;
  onPressSeeAll?: () => void;
}) => (
  <Pressable onPress={onPressSeeAll} style={({ pressed }) => [styles.eventPreviewCard, pressed && styles.pressed]}>
    <ImageBackground imageStyle={styles.eventPreviewImage} source={{ uri: item.imageUrl }} style={styles.eventPreviewImageWrap}>
      <View style={styles.eventPreviewOverlay}>
        <View style={[styles.eventStatusPill, item.status === 'completed' && styles.eventStatusPillCompleted]}>
          <Text style={[styles.eventStatusText, item.status === 'completed' && styles.eventStatusTextCompleted]}>
            {formatEventStatus(item.status)}
          </Text>
        </View>
      </View>
    </ImageBackground>

    <View style={styles.eventPreviewBody}>
      <Text numberOfLines={2} style={styles.eventPreviewTitle}>
        {item.title}
      </Text>
      <Text style={styles.eventPreviewMeta}>{item.date || 'Date pending'}</Text>
      <Text style={styles.eventPreviewMeta}>{item.applicationsCount} applications</Text>
    </View>
  </Pressable>
);

export default function OrganizationProfileScreen({
  embedded = false,
  onOpenNotifications,
  onOpenMenu,
  onOpenEventsHub,
}: Props) {
  const Root = embedded ? View : SafeAreaView;
  const currentUser = getCurrentUser();
  const [profile, setProfile] = useState<OrganizationProfileData | null>(null);
  const [dashboard, setDashboard] = useState<OrganizationDashboardData>(DEFAULT_DASHBOARD);
  const [form, setForm] = useState<OrganizationProfileForm>(buildInitialForm(null));
  const [aiAnswers, setAiAnswers] = useState<OrganizationAiAnswerMap>(buildInitialAiAnswers(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingAiAnswers, setSavingAiAnswers] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [aiLoadingKey, setAiLoadingKey] = useState<AiActionKey | null>(null);
  const [aiResultTitle, setAiResultTitle] = useState('');
  const [aiResultText, setAiResultText] = useState('');
  const [aiActionError, setAiActionError] = useState<string | null>(null);
  const editingRef = useRef(false);

  useEffect(() => {
    editingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      setError('Нужно войти в аккаунт организации, чтобы открыть профиль.');
      return;
    }

    let isActive = true;
    let unsubscribeProfile: () => void = () => {};
    let unsubscribeDashboard: () => void = () => {};

    const boot = async () => {
      try {
        const ensuredProfile = await createDefaultOrganizationProfileIfMissing(
          currentUser.uid,
          currentUser.email ?? undefined,
        );

        if (!isActive) {
          return;
        }

        setProfile(ensuredProfile);
        setForm(buildInitialForm(ensuredProfile));
        setAiAnswers(buildInitialAiAnswers(ensuredProfile));
        setLoading(false);

        unsubscribeProfile = subscribeToOrganizationProfile(
          currentUser.uid,
          currentUser.email ?? undefined,
          (nextProfile) => {
            if (!isActive) {
              return;
            }

            setProfile(nextProfile);

            if (!editingRef.current) {
              setForm(buildInitialForm(nextProfile));
            }
            setAiAnswers(buildInitialAiAnswers(nextProfile));
          },
          (message) => {
            if (isActive) {
              setError(message);
            }
          },
        );

        unsubscribeDashboard = subscribeToOrganizationDashboard(
          currentUser.uid,
          (nextDashboard) => {
            if (isActive) {
              setDashboard(nextDashboard);
            }
          },
          (message) => {
            if (isActive) {
              setError(message);
            }
          },
        );
      } catch (serviceError) {
        if (isActive) {
          setLoading(false);
          setError(
            serviceError instanceof Error
              ? serviceError.message
              : 'Не удалось загрузить профиль организации.',
          );
        }
      }
    };

    void boot();

    return () => {
      isActive = false;
      unsubscribeProfile();
      unsubscribeDashboard();
    };
  }, [currentUser?.email, currentUser?.uid]);

  const completion = useMemo(
    () => (profile ? calculateProfileCompletion(profile) : 0),
    [profile],
  );

  const focusAreaOptions = useMemo(() => {
    const merged = [...FOCUS_AREA_OPTIONS, ...form.focusAreas];
    return Array.from(new Set(merged.filter(Boolean)));
  }, [form.focusAreas]);

  const visibleAvatarUri = avatarPreviewUri || profile?.avatarUrl || null;
  const stats: OrganizationStats = dashboard.stats;
  const latestEvents = dashboard.latestEvents;
  const latestEvent = latestEvents[0];

  const handleStartEdit = () => {
    if (!profile) {
      return;
    }

    setForm(buildInitialForm(profile));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setForm(buildInitialForm(profile));
  };

  const handleAiAnswerChange = (questionId: string, value: string) => {
    setAiAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  };

  const toggleFocusArea = (label: string) => {
    setForm((current) => ({
      ...current,
      focusAreas: current.focusAreas.includes(label)
        ? current.focusAreas.filter((item) => item !== label)
        : [...current.focusAreas, label],
    }));
  };

  const handleSaveProfile = async () => {
    if (!currentUser?.uid) {
      setError('Сессия не найдена. Войдите снова.');
      return;
    }

    if (!form.organizationName.trim()) {
      setError('Введите название организации.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updateOrganizationProfile(currentUser.uid, {
        organizationName: form.organizationName,
        contactPerson: form.contactPerson,
        location: form.location,
        organizationType: form.organizationType,
        tagline: form.tagline,
        focusAreas: form.focusAreas,
        description: form.description,
      });

      setIsEditing(false);
    } catch (serviceError) {
      setError(
        serviceError instanceof Error
          ? serviceError.message
          : 'Не удалось сохранить профиль организации.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAiAnswers = async () => {
    if (!currentUser?.uid) {
      setError('Сессия не найдена. Войдите снова.');
      return;
    }

    setSavingAiAnswers(true);
    setError(null);

    try {
      await updateOrganizationProfile(currentUser.uid, {
        aiQuestionnaireAnswers: aiAnswers,
      });
    } catch (serviceError) {
      setError(
        serviceError instanceof Error
          ? serviceError.message
          : 'Не удалось сохранить AI-ответы организации.',
      );
    } finally {
      setSavingAiAnswers(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!currentUser?.uid) {
      setError('Сессия не найдена. Войдите снова.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError('Дайте доступ к галерее, чтобы выбрать логотип организации.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
    });

    if (result.canceled || !result.assets?.[0]?.uri) {
      return;
    }

    const localUri = result.assets[0].uri;
    setAvatarPreviewUri(localUri);
    setUploadingAvatar(true);
    setError(null);

    try {
      const avatarUrl = await uploadOrganizationAvatar(currentUser.uid, localUri);
      await updateOrganizationProfile(currentUser.uid, { avatarUrl });
      setProfile((current) => (current ? { ...current, avatarUrl } : current));
    } catch (serviceError) {
      setError(
        serviceError instanceof Error
          ? serviceError.message
          : 'Не удалось обновить логотип организации.',
      );
    } finally {
      setUploadingAvatar(false);
      setAvatarPreviewUri(null);
    }
  };

  const handleAiAction = async (action: AiActionKey) => {
    if (!profile) {
      setAiActionError('Сначала дождитесь загрузки профиля организации.');
      return;
    }

    console.log('[Organization AI Assistant]', action);
    setAiLoadingKey(action);
    setAiActionError(null);
    setAiResultText('');

    try {
      let resultTitle = '';
      let resultText = '';

      switch (action) {
        case 'create-task':
          resultTitle = 'Черновик новой задачи';
          resultText = await draftOrganizationTask(profile);
          break;
        case 'improve-event-description':
          resultTitle = 'Улучшенное описание события';
          resultText = await improveEventDescription({
            organizationName: profile.organizationName,
            tagline: profile.tagline,
            focusAreas: profile.focusAreas,
            organizationType: profile.organizationType,
            eventTitle: latestEvent?.title,
            eventDescription: profile.description,
          });
          break;
        case 'suggest-skills':
          resultTitle = 'Подсказка по навыкам';
          resultText = await suggestNeededSkills({
            organizationName: profile.organizationName,
            focusAreas: profile.focusAreas,
            organizationType: profile.organizationType,
            description: profile.description,
            eventTitle: latestEvent?.title,
          });
          break;
        case 'profile-gaps':
          resultTitle = 'Слабые места профиля';
          resultText = await analyzeOrganizationProfile(profile);
          break;
      }

      setAiResultTitle(resultTitle);
      setAiResultText(resultText);
    } catch (serviceError) {
      setAiActionError(
        serviceError instanceof Error
          ? serviceError.message
          : 'Не удалось получить ответ от AI. Попробуйте ещё раз.',
      );
    } finally {
      setAiLoadingKey(null);
    }
  };

  if (loading) {
    return (
      <Root style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#3E55DE" size="large" />
            <Text style={styles.loadingTitle}>Loading organization profile</Text>
            <Text style={styles.loadingSubtitle}>
              Подтягиваем данные из Firebase и собираем ваш рабочий кабинет.
            </Text>
          </View>
        </View>
      </Root>
    );
  }

  return (
    <Root style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[styles.content, embedded && styles.contentEmbedded]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>Volunet</Text>
            <Text style={styles.pageTitle}>Organization Profile</Text>
          </View>

          <View style={styles.headerActions}>
            <HeaderIconButton onPress={onOpenNotifications}>
              <Image resizeMode="contain" source={ASSETS.bell} style={styles.headerIconImage} />
            </HeaderIconButton>
            <HeaderIconButton onPress={onOpenMenu}>
              <MenuIcon />
            </HeaderIconButton>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.heroWrap}>
          <View style={styles.heroGlowLarge} />
          <View style={styles.heroGlowSmall} />

          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Profile ready {completion}%</Text>
            </View>

            <View style={styles.avatarShell}>
              <Pressable
                disabled={uploadingAvatar}
                onPress={() => void handlePickAvatar()}
                style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
              >
                {visibleAvatarUri ? (
                  <Image source={{ uri: visibleAvatarUri }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitials}>
                      {initialsFromName(profile?.organizationName || 'Volunet')}
                    </Text>
                  </View>
                )}

                <View style={styles.avatarEditBadge}>
                  {uploadingAvatar ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.avatarEditBadgeText}>+</Text>
                  )}
                </View>
              </Pressable>
            </View>

            <Text style={styles.organizationName}>
              {profile?.organizationName || 'Your organization'}
            </Text>
            <Text style={styles.tagline}>
              {profile?.tagline || 'Добавьте короткую строку о миссии и стиле вашей команды.'}
            </Text>

            <View style={styles.heroMetaRow}>
              <View style={styles.heroMetaPill}>
                <Text style={styles.heroMetaText}>
                  {profile?.location || 'Location pending'}
                </Text>
              </View>
              <View style={styles.heroMetaPill}>
                <Text style={styles.heroMetaText}>
                  {profile?.organizationType || 'Type pending'}
                </Text>
              </View>
            </View>

            <Pressable
              disabled={saving}
              onPress={isEditing ? undefined : handleStartEdit}
              style={({ pressed }) => [
                styles.primaryButton,
                isEditing && styles.primaryButtonMuted,
                pressed && !isEditing && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {isEditing ? 'Editing now' : 'Edit profile'}
              </Text>
            </Pressable>

            <Pressable
              disabled={uploadingAvatar}
              onPress={() => void handlePickAvatar()}
              style={({ pressed }) => [styles.secondaryInlineButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryInlineButtonText}>
                {profile?.avatarUrl ? 'Change photo' : 'Add photo'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Information</Text>
              <Text style={styles.sectionSubtitle}>
                Контекст, который видят волонтёры и будущие AI-инструменты.
              </Text>
            </View>
            {!isEditing ? (
              <Pressable onPress={handleStartEdit} style={({ pressed }) => [styles.ghostAction, pressed && styles.pressed]}>
                <Text style={styles.ghostActionText}>Edit</Text>
              </Pressable>
            ) : null}
          </View>

          {isEditing ? (
            <>
              <EditableField
                label="Organization name"
                onChangeText={(value) => setForm((current) => ({ ...current, organizationName: value }))}
                placeholder="Например, Green City Foundation"
                value={form.organizationName}
              />
              <EditableField
                label="Contact person"
                onChangeText={(value) => setForm((current) => ({ ...current, contactPerson: value }))}
                placeholder="Кто ведёт коммуникацию"
                value={form.contactPerson}
              />
              <EditableField
                label="Location"
                onChangeText={(value) => setForm((current) => ({ ...current, location: value }))}
                placeholder="Город или регион"
                value={form.location}
              />
              <EditableField
                label="Organization type"
                onChangeText={(value) => setForm((current) => ({ ...current, organizationType: value }))}
                placeholder="Например, NGO"
                value={form.organizationType}
              />
              <EditableField
                label="Tagline"
                onChangeText={(value) => setForm((current) => ({ ...current, tagline: value }))}
                placeholder="Короткая строка под названием"
                value={form.tagline}
              />

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Focus areas</Text>
                <View style={styles.focusWrap}>
                  {focusAreaOptions.map((item) => (
                    <FocusAreaChip
                      key={item}
                      label={item}
                      onPress={() => toggleFocusArea(item)}
                      selected={form.focusAreas.includes(item)}
                    />
                  ))}
                </View>
              </View>

              <EditableField
                label="Description"
                multiline
                onChangeText={(value) => setForm((current) => ({ ...current, description: value }))}
                placeholder="Опишите миссию организации, формат помощи и ваш стиль работы с волонтёрами."
                value={form.description}
              />

              <View style={styles.editActionsRow}>
                <Pressable
                  disabled={saving}
                  onPress={handleCancelEdit}
                  style={({ pressed }) => [styles.editGhostButton, pressed && styles.pressed]}
                >
                  <Text style={styles.editGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={saving}
                  onPress={() => void handleSaveProfile()}
                  style={({ pressed }) => [
                    styles.editPrimaryButton,
                    saving && styles.editPrimaryButtonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.editPrimaryText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <InfoRow label="Organization name" value={profile?.organizationName ?? ''} />
              <InfoRow label="Contact person" value={profile?.contactPerson ?? ''} />
              <InfoRow label="Email" value={profile?.email ?? currentUser?.email ?? ''} />
              <InfoRow label="Location" value={profile?.location ?? ''} />
              <InfoRow label="Organization type" value={profile?.organizationType ?? ''} />

              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>Focus areas</Text>
                <View style={styles.focusWrap}>
                  {profile?.focusAreas?.length ? (
                    profile.focusAreas.map((item) => <FocusAreaChip key={item} label={item} />)
                  ) : (
                    <Text style={styles.emptyText}>Добавьте фокус-направления, чтобы профиль выглядел сильнее.</Text>
                  )}
                </View>
              </View>

              <View style={styles.infoBlockLast}>
                <Text style={styles.infoLabel}>Description</Text>
                <Text style={styles.descriptionText}>
                  {profile?.description || 'Пока без описания. Расскажите, чем вы занимаетесь и как работаете с волонтёрами.'}
                </Text>
              </View>
            </>
          )}
        </View>

        <View style={[styles.card, styles.aiQuestionsCard]}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>AI Context</Text>
              <Text style={styles.sectionSubtitle}>
                Ответьте на несколько вопросов, чтобы AI лучше понимал стиль вашей организации.
              </Text>
            </View>
          </View>

          {ORGANIZATION_AI_QUESTIONS.map((item) => (
            <View key={item.id} style={styles.aiQuestionBlock}>
              <Text style={styles.aiQuestionPrompt}>{item.question}</Text>

              <View style={styles.aiQuestionOptionsWrap}>
                {item.options.map((option) => {
                  const selected = aiAnswers[item.id] === option;

                  return (
                    <Pressable
                      key={`${item.id}-${option}`}
                      onPress={() => handleAiAnswerChange(item.id, option)}
                      style={({ pressed }) => [
                        styles.aiOptionChip,
                        selected && styles.aiOptionChipSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.aiOptionChipText, selected && styles.aiOptionChipTextSelected]}>
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                onChangeText={(value) => handleAiAnswerChange(item.id, value)}
                placeholder="Или свой вариант"
                placeholderTextColor="#A0A6BD"
                style={styles.aiQuestionCustomInput}
                value={aiAnswers[item.id] ?? ''}
              />
            </View>
          ))}

          <Pressable
            disabled={savingAiAnswers}
            onPress={() => void handleSaveAiAnswers()}
            style={({ pressed }) => [
              styles.aiAnswersSaveButton,
              savingAiAnswers && styles.aiAnswersSaveButtonDisabled,
              pressed && !savingAiAnswers && styles.pressed,
            ]}
          >
            {savingAiAnswers ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.aiAnswersSaveButtonText}>Сохранить ответы для AI</Text>
            )}
          </Pressable>
        </View>

        <View style={[styles.card, styles.aiCard]}>
          <View style={styles.aiGlowOne} />
          <View style={styles.aiGlowTwo} />

          <Text style={styles.sectionTitle}>AI Assistant</Text>
          <Text style={styles.aiSubtitle}>
            Умные инструменты для задач, событий и качества профиля. Сейчас это красивые точки
            входа, позже сюда подключится backend-интеграция с AI.
          </Text>

          <View style={styles.aiActionsGrid}>
            {AI_ACTIONS.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => void handleAiAction(item.key)}
                style={({ pressed }) => [
                  styles.aiActionCard,
                  aiLoadingKey === item.key && styles.aiActionCardLoading,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.aiActionBadge}>
                  <Text style={styles.aiActionBadgeText}>AI</Text>
                </View>
                <Text style={styles.aiActionTitle}>{item.title}</Text>
                <Text style={styles.aiActionCaption}>{item.caption}</Text>
                {aiLoadingKey === item.key ? (
                  <View style={styles.aiActionLoadingRow}>
                    <ActivityIndicator color="#3E55DE" size="small" />
                    <Text style={styles.aiActionLoadingText}>Готовим ответ...</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>

          {aiActionError ? (
            <View style={styles.aiResultErrorCard}>
              <Text style={styles.aiResultErrorText}>{aiActionError}</Text>
            </View>
          ) : null}

          {aiResultText ? (
            <View style={styles.aiResultCard}>
              <Text style={styles.aiResultTitle}>{aiResultTitle}</Text>
              <Text style={styles.aiResultBody}>{aiResultText}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Stats</Text>
              <Text style={styles.sectionSubtitle}>
                Реальные цифры из ваших событий и откликов в Firebase.
              </Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <StatCard label="Events" tint="blue" value={stats.events} />
            <StatCard label="Active" tint="mint" value={stats.active} />
            <StatCard label="Applications" tint="peach" value={stats.applications} />
            <StatCard label="Completed" tint="lavender" value={stats.completed} />
          </View>
        </View>

        <View style={[styles.card, styles.eventsCard]}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Your events</Text>
              <Text style={styles.sectionSubtitle}>
                Последние опубликованные возможности и их текущее состояние.
              </Text>
            </View>
            <Pressable onPress={onOpenEventsHub} style={({ pressed }) => [styles.ghostAction, pressed && styles.pressed]}>
              <Text style={styles.ghostActionText}>See all</Text>
            </Pressable>
          </View>

          {latestEvents.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.eventsScroller}>
              {latestEvents.map((item) => (
                <EventPreviewCard key={item.id} item={item} onPressSeeAll={onOpenEventsHub} />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyEventsCard}>
              <Text style={styles.emptyEventsTitle}>No events yet</Text>
              <Text style={styles.emptyEventsText}>
                Когда организация создаст события, здесь появится аккуратный превью-блок с датами,
                статусами и количеством откликов.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </Root>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F3F3F5' },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 44 },
  contentEmbedded: { paddingBottom: 138 },
  loadingWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  loadingCard: {
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 34,
    alignItems: 'center',
    shadowColor: '#18204A',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
  },
  loadingTitle: {
    marginTop: 14,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#10194E',
    textAlign: 'center',
  },
  loadingSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    color: '#7D8299',
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerCopy: { flex: 1, paddingRight: 16 },
  brand: {
    fontSize: 14,
    fontWeight: '800',
    color: '#7D84A1',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  pageTitle: { fontSize: 30, lineHeight: 35, fontWeight: '800', color: '#10194E' },
  headerActions: { flexDirection: 'row' },
  headerButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    shadowColor: '#20295D',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 5,
  },
  headerIconImage: { width: 24, height: 24 },
  menuGlyph: { width: 24, justifyContent: 'center', alignItems: 'center' },
  menuLine: {
    width: 18,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#242C3E',
    marginVertical: 2,
  },
  errorBanner: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(198, 68, 90, 0.12)',
    backgroundColor: '#FFF4F6',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  errorText: { fontSize: 14, lineHeight: 20, color: '#BE4058', fontWeight: '600' },
  heroWrap: { position: 'relative', marginBottom: 20 },
  heroGlowLarge: {
    position: 'absolute',
    top: 14,
    left: 12,
    right: 12,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#EEF1FF',
    opacity: 0.96,
  },
  heroGlowSmall: {
    position: 'absolute',
    top: 48,
    right: -14,
    width: 158,
    height: 158,
    borderRadius: 79,
    backgroundColor: 'rgba(220, 228, 255, 0.85)',
  },
  heroCard: {
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 24,
    alignItems: 'center',
    shadowColor: '#1D2552',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    marginBottom: 18,
  },
  heroBadgeText: { fontSize: 12, fontWeight: '800', color: '#4460DD' },
  avatarShell: { marginBottom: 16 },
  avatarButton: { width: 112, height: 112, borderRadius: 56 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 56 },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 56,
    backgroundColor: '#DFE7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { fontSize: 34, fontWeight: '800', color: '#4B63E8' },
  avatarEditBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#10194E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  avatarEditBadgeText: {
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: -1,
  },
  organizationName: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: '#10194E',
    textAlign: 'center',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    color: '#8288A0',
    textAlign: 'center',
    marginBottom: 18,
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroMetaPill: {
    borderRadius: 999,
    backgroundColor: '#F4F5FA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 5,
    marginBottom: 10,
  },
  heroMetaText: { fontSize: 12, fontWeight: '700', color: '#667090' },
  primaryButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: '#10194E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonMuted: { backgroundColor: '#CBD1E6' },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  secondaryInlineButton: {
    marginTop: 12,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryInlineButtonText: { fontSize: 13, fontWeight: '800', color: '#5462B4' },
  card: {
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 20,
    shadowColor: '#1D2552',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    color: '#10194E',
    marginBottom: 6,
  },
  sectionSubtitle: { fontSize: 14, lineHeight: 20, color: '#8C90A8', maxWidth: 250 },
  ghostAction: {
    minHeight: 40,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostActionText: { fontSize: 13, fontWeight: '800', color: '#405AD9' },
  infoRow: {
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEF0F6',
  },
  infoBlock: { paddingTop: 14 },
  infoBlockLast: { paddingTop: 14 },
  infoLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#8B90A7',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 7,
  },
  infoValue: { fontSize: 15, lineHeight: 22, color: '#1B2556', fontWeight: '600' },
  descriptionText: { fontSize: 15, lineHeight: 22, color: '#59607B' },
  emptyText: { fontSize: 14, lineHeight: 20, color: '#8C90A8' },
  fieldBlock: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#46507A', marginBottom: 8 },
  input: {
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: '#F6F7FB',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#10194E',
  },
  inputMultiline: { minHeight: 126, paddingTop: 14, paddingBottom: 14 },
  focusWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  focusChip: {
    borderRadius: 999,
    backgroundColor: '#F6F7FB',
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginRight: 10,
    marginBottom: 10,
  },
  focusChipSelected: { backgroundColor: '#E8EEFF' },
  focusChipText: { fontSize: 13, fontWeight: '700', color: '#59627E' },
  focusChipTextSelected: { color: '#3350DF' },
  editActionsRow: { flexDirection: 'row', marginTop: 6 },
  editGhostButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: '#F4F5FA',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  editGhostText: { fontSize: 15, fontWeight: '800', color: '#66708F' },
  editPrimaryButton: {
    flex: 1.15,
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: '#4059E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPrimaryButtonDisabled: { opacity: 0.5 },
  editPrimaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  aiCard: { overflow: 'hidden' },
  aiGlowOne: {
    position: 'absolute',
    right: -32,
    top: -18,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(229, 234, 255, 0.82)',
  },
  aiGlowTwo: {
    position: 'absolute',
    left: -36,
    bottom: -24,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(242, 245, 255, 0.9)',
  },
  aiSubtitle: { fontSize: 14, lineHeight: 21, color: '#70779A', marginBottom: 16 },
  aiQuestionsCard: {
    marginBottom: 20,
  },
  aiQuestionBlock: {
    borderRadius: 22,
    backgroundColor: '#F8F9FF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  aiQuestionPrompt: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    color: '#10194E',
    marginBottom: 10,
  },
  aiQuestionOptionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  aiOptionChip: {
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  aiOptionChipSelected: {
    backgroundColor: '#3853E3',
  },
  aiOptionChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#41507F',
  },
  aiOptionChipTextSelected: {
    color: '#FFFFFF',
  },
  aiQuestionCustomInput: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#10194E',
  },
  aiAnswersSaveButton: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: '#2C46DA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  aiAnswersSaveButtonDisabled: {
    opacity: 0.75,
  },
  aiAnswersSaveButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  aiActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  aiActionCard: {
    width: '48.5%',
    borderRadius: 22,
    backgroundColor: '#F8F9FF',
    paddingHorizontal: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },
  aiActionCardLoading: {
    borderWidth: 1,
    borderColor: '#D9E1FF',
  },
  aiActionBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#E8EEFF',
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 12,
  },
  aiActionBadgeText: { fontSize: 11, fontWeight: '800', color: '#3653E0' },
  aiActionTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    color: '#10194E',
    marginBottom: 8,
  },
  aiActionCaption: { fontSize: 13, lineHeight: 19, color: '#7E84A0' },
  aiActionLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  aiActionLoadingText: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#3E55DE',
  },
  aiResultErrorCard: {
    marginTop: 6,
    borderRadius: 22,
    backgroundColor: '#FFF2F4',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  aiResultErrorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#B83C56',
    fontWeight: '700',
  },
  aiResultCard: {
    marginTop: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  aiResultTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: '#10194E',
    marginBottom: 8,
  },
  aiResultBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#56607F',
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: {
    width: '48.4%',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 12,
  },
  statCardBlue: { backgroundColor: '#EEF3FF' },
  statCardMint: { backgroundColor: '#ECF8F2' },
  statCardPeach: { backgroundColor: '#FFF3EC' },
  statCardLavender: { backgroundColor: '#F3EEFF' },
  statValue: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: '#10194E',
    marginBottom: 4,
  },
  statLabel: { fontSize: 14, fontWeight: '700', color: '#5E6784' },
  eventsCard: { paddingRight: 0 },
  eventsScroller: { marginRight: 0 },
  eventPreviewCard: {
    width: 228,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F7F8FC',
    marginRight: 14,
  },
  eventPreviewImageWrap: { height: 146, justifyContent: 'flex-start' },
  eventPreviewImage: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  eventPreviewOverlay: {
    padding: 14,
    backgroundColor: 'rgba(18, 24, 47, 0.12)',
    flex: 1,
  },
  eventStatusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eventStatusPillCompleted: { backgroundColor: 'rgba(247, 235, 238, 0.95)' },
  eventStatusText: { fontSize: 11, fontWeight: '800', color: '#2F49D5' },
  eventStatusTextCompleted: { color: '#BA4B61' },
  eventPreviewBody: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16 },
  eventPreviewTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: '#10194E',
    marginBottom: 8,
  },
  eventPreviewMeta: { fontSize: 13, lineHeight: 18, color: '#7F86A1', marginBottom: 4 },
  emptyEventsCard: {
    borderRadius: 22,
    backgroundColor: '#F7F8FC',
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginRight: 20,
  },
  emptyEventsTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#10194E',
    marginBottom: 8,
  },
  emptyEventsText: { fontSize: 14, lineHeight: 21, color: '#7D84A1' },
  pressed: { opacity: 0.92 },
});
