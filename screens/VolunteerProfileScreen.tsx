import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { getCurrentUser } from '../services/authService';
import {
  EMPTY_VOLUNTEER_STATS,
  addVolunteerInterest,
  addVolunteerSkill,
  calculateProfileCompletion,
  ensureVolunteerProfile,
  removeVolunteerInterest,
  removeVolunteerSkill,
  subscribeToVolunteerProfile,
  subscribeToVolunteerStats,
  updateVolunteerProfile,
  uploadVolunteerAvatar,
} from '../services/volunteerProfileService';
import { VolunteerProfileData, VolunteerProfileInsights, VolunteerStats } from '../types/profile';

export type VolunteerProfileTabKey = 'home' | 'match' | 'saved' | 'profile';

type Props = {
  activeTab?: VolunteerProfileTabKey;
  showBottomBar?: boolean;
  embedded?: boolean;
  onOpenNotifications?: () => void;
  onOpenMenu?: () => void;
  onSelectTab?: (tab: VolunteerProfileTabKey) => void;
};

type EditorMode = 'profile' | 'ai' | 'skill' | 'interest' | null;

const ASSETS = {
  bell: require('../assets/icons/categories/bell-cutout.png'),
  ai: require('../assets/icons/categories/icon-ai-helper.png'),
  impact: require('../assets/icons/categories/icon-ai-assistant.png'),
  statEvents: require('../assets/icons/categories/icon-stat-events.png'),
  statHours: require('../assets/icons/categories/icon-stat-hours.png'),
  statThanks: require('../assets/icons/categories/icon-stat-thanks.png'),
  tabHome: require('../assets/icons/categories/home.png'),
  tabMatch: require('../assets/icons/categories/match.png'),
  tabSaved: require('../assets/icons/categories/saved.png'),
  tabProfile: require('../assets/icons/categories/profile.png'),
};

const TABS: Array<{ key: VolunteerProfileTabKey; label: string; icon: number }> = [
  { key: 'home', label: 'Главная', icon: ASSETS.tabHome },
  { key: 'match', label: 'Матч', icon: ASSETS.tabMatch },
  { key: 'saved', label: 'Сохран.', icon: ASSETS.tabSaved },
  { key: 'profile', label: 'Профиль', icon: ASSETS.tabProfile },
];

const DEFAULT_INSIGHTS: VolunteerProfileInsights = {
  impactHeadline: 'Профиль ждёт первую настоящую волонтёрскую историю.',
  impactBody:
    'Когда появятся участия, завершённые задачи и благодарности, этот блок наполнится реальными достижениями из Firebase.',
  reliabilityLabel: 'Надёжность появится после первых участий',
  activityItems: [
    {
      id: 'empty',
      title: 'Добавьте больше информации о себе.',
      subtitle: 'Навыки, интересы и описание помогут AI лучше подбирать события и роли.',
    },
  ],
};

const initialsFromName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (parts.length === 0) {
    return 'V';
  }

  return parts.map((item) => item[0]?.toUpperCase() ?? '').join('') || 'V';
};

const formatHours = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.0', '');

const SectionHeader = ({
  title,
  subtitle,
  actionLabel,
  onPress,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onPress?: () => void;
}) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionHeaderCopy}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
    {actionLabel ? (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}>
        <Text style={styles.sectionActionText}>{actionLabel}</Text>
      </Pressable>
    ) : null}
  </View>
);

const Chip = ({
  label,
  tint,
  onRemove,
}: {
  label: string;
  tint: 'blue' | 'mint';
  onRemove: () => void;
}) => (
  <View style={[styles.chip, tint === 'mint' && styles.chipMint]}>
    <Text style={[styles.chipText, tint === 'mint' && styles.chipTextMint]}>{label}</Text>
    <Pressable onPress={onRemove} style={({ pressed }) => [styles.chipRemove, pressed && styles.pressed]}>
      <Text style={[styles.inlineIconText, tint === 'mint' && styles.inlineIconTextMint]}>×</Text>
    </Pressable>
  </View>
);

const StatCard = ({
  accent,
  helper,
  icon,
  label,
  value,
  fallback,
}: {
  accent: 'blue' | 'lavender' | 'mint' | 'warm';
  helper: string;
  icon?: number;
  label: string;
  value: string;
  fallback?: React.ReactNode;
}) => (
  <View
    style={[
      styles.statCard,
      accent === 'blue'
        ? styles.statBlue
        : accent === 'lavender'
          ? styles.statLavender
          : accent === 'mint'
            ? styles.statMint
            : styles.statWarm,
    ]}
  >
    <View style={styles.statIconWrap}>
      {icon ? <Image resizeMode="contain" source={icon} style={styles.statIcon} /> : fallback}
    </View>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statHelper}>{helper}</Text>
  </View>
);

const EditorSheet = ({
  visible,
  title,
  subtitle,
  size = 'tall',
  onClose,
  primaryLabel,
  primaryDisabled,
  loading,
  onPrimaryPress,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  size?: 'compact' | 'tall';
  onClose: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  loading?: boolean;
  onPrimaryPress: () => void;
  children: React.ReactNode;
}) => {
  const { height: windowHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const baseHeight = size === 'tall' ? windowHeight * 0.76 : windowHeight * 0.46;
  const maxHeight = size === 'tall' ? windowHeight * 0.94 : windowHeight * 0.62;
  const minHeight = size === 'tall' ? 420 : 300;
  const keyboardGap = size === 'tall' ? 22 : 18;
  const keyboardOffset = keyboardHeight > 0 ? Math.max(0, keyboardHeight - 6) : 0;
  const keyboardAwareHeight =
    keyboardHeight > 0
      ? Math.min(baseHeight, Math.max(minHeight, windowHeight - keyboardHeight - keyboardGap))
      : baseHeight;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.sheetOverlay}>
        <Pressable onPress={onClose} style={styles.sheetBackdrop} />
        <View style={styles.sheetKeyboard}>
          <View
            style={[
              styles.sheet,
              {
                height: keyboardAwareHeight,
                maxHeight,
                marginBottom: keyboardOffset,
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{title}</Text>
            {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
            <View style={styles.sheetContent}>{children}</View>
            <View style={styles.sheetActions}>
              <Pressable onPress={onClose} style={({ pressed }) => [styles.sheetGhostButton, pressed && styles.pressed]}>
                <Text style={styles.sheetGhostText}>Отмена</Text>
              </Pressable>
              <Pressable
                disabled={primaryDisabled || loading}
                onPress={onPrimaryPress}
                style={({ pressed }) => [
                  styles.sheetPrimaryButton,
                  (primaryDisabled || loading) && styles.sheetPrimaryButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.sheetPrimaryText}>{primaryLabel}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      autoCapitalize={autoCapitalize}
      multiline={multiline}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#9AA3C5"
      style={[styles.fieldInput, multiline && styles.fieldInputMultiline]}
      textAlignVertical={multiline ? 'top' : 'center'}
      value={value}
    />
  </View>
);

export default function VolunteerProfileScreen({
  activeTab = 'profile',
  showBottomBar = true,
  embedded = false,
  onOpenNotifications,
  onOpenMenu,
  onSelectTab,
}: Props) {
  const Root = embedded ? View : SafeAreaView;
  const user = getCurrentUser();
  const [profile, setProfile] = useState<VolunteerProfileData | null>(null);
  const [stats, setStats] = useState<VolunteerStats>(EMPTY_VOLUNTEER_STATS);
  const [insights, setInsights] = useState<VolunteerProfileInsights>(DEFAULT_INSIGHTS);
  const [initialLoading, setInitialLoading] = useState(true);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({ fullName: '', handle: '', city: '', bio: '' });
  const [aiDraft, setAiDraft] = useState('');
  const [chipDraft, setChipDraft] = useState('');
  const profileRef = useRef<VolunteerProfileData | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    if (!user) {
      setInitialLoading(false);
      setScreenError('Нужно войти в аккаунт, чтобы открыть профиль.');
      return;
    }

    let active = true;
    let unsubscribeProfile: () => void = () => {};
    let unsubscribeStats: () => void = () => {};

    const boot = async () => {
      try {
        const ensured = await ensureVolunteerProfile(user);

        if (!active) {
          return;
        }

        setProfile(ensured);
        setProfileForm({
          fullName: ensured.fullName,
          handle: ensured.handle,
          city: ensured.city,
          bio: ensured.bio,
        });
        setAiDraft(ensured.aiAbout);
        setInitialLoading(false);

        unsubscribeProfile = subscribeToVolunteerProfile(
          user,
          (nextProfile) => {
            if (!active) {
              return;
            }

            setProfile(nextProfile);
            setProfileForm({
              fullName: nextProfile.fullName,
              handle: nextProfile.handle,
              city: nextProfile.city,
              bio: nextProfile.bio,
            });
            setAiDraft(nextProfile.aiAbout);
          },
          (message) => {
            if (active) {
              setScreenError(message);
            }
          },
        );

        unsubscribeStats = subscribeToVolunteerStats(
          user.uid,
          (nextStats, nextInsights) => {
            if (!active) {
              return;
            }

            setStats(nextStats);
            setInsights(nextInsights);
          },
          () => profileRef.current,
          (message) => {
            if (active) {
              setScreenError(message);
            }
          },
        );
      } catch (error) {
        if (active) {
          setInitialLoading(false);
          setScreenError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
        }
      }
    };

    void boot();

    return () => {
      active = false;
      unsubscribeProfile();
      unsubscribeStats();
    };
  }, [user]);

  const completionPercent = useMemo(() => (profile ? calculateProfileCompletion(profile) : 0), [profile]);

  const openEditor = (mode: Exclude<EditorMode, null>) => {
    if (!profile) {
      return;
    }

    if (mode === 'profile') {
      setProfileForm({
        fullName: profile.fullName,
        handle: profile.handle,
        city: profile.city,
        bio: profile.bio,
      });
    }

    if (mode === 'ai') {
      setAiDraft(profile.aiAbout);
    }

    setChipDraft('');
    setEditorMode(mode);
  };

  const closeEditor = () => {
    if (!saving) {
      setEditorMode(null);
      setChipDraft('');
    }
  };

  const withUser = async (callback: (userId: string) => Promise<void>) => {
    if (!user) {
      throw new Error('Сессия не найдена. Войдите в аккаунт заново.');
    }

    await callback(user.uid);
  };

  const handleSaveProfile = async () => {
    if (!profileForm.fullName.trim()) {
      setScreenError('Имя не может быть пустым.');
      return;
    }

    setSaving(true);
    setScreenError(null);

    try {
      await withUser((userId) =>
        updateVolunteerProfile(userId, {
          fullName: profileForm.fullName,
          handle: profileForm.handle,
          city: profileForm.city,
          bio: profileForm.bio,
        }),
      );
      setEditorMode(null);
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Не удалось сохранить профиль.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAi = async () => {
    setSaving(true);
    setScreenError(null);

    try {
      await withUser((userId) => updateVolunteerProfile(userId, { aiAbout: aiDraft }));
      setEditorMode(null);
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Не удалось сохранить описание.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddChip = async () => {
    const value = chipDraft.trim();

    if (!value) {
      setScreenError(editorMode === 'skill' ? 'Введите навык.' : 'Введите интерес.');
      return;
    }

    setSaving(true);
    setScreenError(null);

    try {
      await withUser((userId) =>
        editorMode === 'skill' ? addVolunteerSkill(userId, value) : addVolunteerInterest(userId, value),
      );
      setEditorMode(null);
      setChipDraft('');
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Не удалось обновить профиль.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSkill = async (skill: string) => {
    try {
      await withUser((userId) => removeVolunteerSkill(userId, skill));
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Не удалось удалить навык.');
    }
  };

  const handleRemoveInterest = async (interest: string) => {
    try {
      await withUser((userId) => removeVolunteerInterest(userId, interest));
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Не удалось удалить интерес.');
    }
  };

  const startAvatarUpload = async (uri: string) => {
    if (!user) {
      setScreenError('Сессия не найдена. Войдите в аккаунт заново.');
      return;
    }

    setAvatarPreviewUri(uri);
    setUploadingAvatar(true);
    setScreenError(null);

    try {
      const nextUrl = await uploadVolunteerAvatar(user.uid, uri);
      setProfile((current) => (current ? { ...current, avatarUrl: nextUrl } : current));
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : 'Не удалось обновить фото профиля.');
    } finally {
      setUploadingAvatar(false);
      setAvatarPreviewUri(null);
    }
  };

  const handlePickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setScreenError('Дайте доступ к галерее, чтобы выбрать фото профиля.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      await startAvatarUpload(result.assets[0].uri);
    }
  };

  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      setScreenError('Дайте доступ к камере, чтобы сделать фото профиля.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      cameraType: ImagePicker.CameraType.front,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      await startAvatarUpload(result.assets[0].uri);
    }
  };

  const openAvatarActions = () => {
    if (uploadingAvatar) {
      return;
    }

    Alert.alert('Фото профиля', 'Выберите источник фото.', [
      { text: 'Галерея', onPress: () => void handlePickFromGallery() },
      { text: 'Камера', onPress: () => void handleTakePhoto() },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  const heroText = profile?.bio.trim()
    ? profile.bio
    : 'Добавьте короткую строку о себе, чтобы профиль сразу лучше понимали организации.';

  const aiText = profile?.aiAbout.trim()
    ? profile.aiAbout
    : 'Расскажите AI, какие роли и форматы помощи вам подходят, чтобы рекомендации стали точнее.';

  return (
    <Root style={styles.safeArea}>
      <View style={styles.screen}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[styles.content, showBottomBar ? styles.contentWithBar : styles.contentEmbedded]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.headerEyebrow}>Volunet</Text>
              <Text style={styles.headerTitle}>Профиль</Text>
            </View>

            <View style={styles.headerActions}>
              <Pressable onPress={onOpenNotifications} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
                <Image resizeMode="contain" source={ASSETS.bell} style={styles.headerIconImage} />
              </Pressable>
              <Pressable onPress={onOpenMenu} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
                <View style={styles.menuGlyph}>
                  <View style={styles.menuLine} />
                  <View style={styles.menuLine} />
                  <View style={styles.menuLine} />
                </View>
              </Pressable>
            </View>
          </View>

          {screenError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{screenError}</Text>
            </View>
          ) : null}

          {initialLoading && !profile ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color="#4A63F5" size="large" />
              <Text style={styles.loadingTitle}>Загружаем профиль волонтёра</Text>
              <Text style={styles.loadingSubtitle}>
                Проверяем данные в Firebase, создаём недостающие поля и подключаем живую статистику.
              </Text>
            </View>
          ) : null}

          {!initialLoading && profile ? (
            <>
              <View style={styles.heroWrap}>
                <View style={styles.heroAuraLarge} />
                <View style={styles.heroAuraSoft} />

                <View style={styles.heroCard}>
                  <View style={styles.avatarFrame}>
                    <Pressable onPress={openAvatarActions} style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}>
                      {avatarPreviewUri || profile.avatarUrl ? (
                        <Image
                          resizeMode="cover"
                          source={{ uri: avatarPreviewUri || profile.avatarUrl || '' }}
                          style={styles.avatarImage}
                        />
                      ) : (
                        <View style={styles.avatarPlaceholder}>
                          <Text style={styles.avatarInitials}>{initialsFromName(profile.fullName)}</Text>
                        </View>
                      )}

                      <View style={styles.avatarBadge}>
                        {uploadingAvatar ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <Text style={styles.avatarBadgeText}>+</Text>
                        )}
                      </View>
                    </Pressable>
                  </View>

                  <View style={styles.completionBadge}>
                    <View style={styles.completionDot} />
                    <Text style={styles.completionText}>{completionPercent}% заполнено</Text>
                  </View>

                  <Text style={styles.profileName}>{profile.fullName}</Text>
                  <Text style={styles.profileHandle}>{profile.handle}</Text>
                  <Text style={styles.profileBio}>{heroText}</Text>

                  <View style={styles.heroPills}>
                    <View style={styles.heroPill}>
                      <Text style={styles.heroPillText}>{profile.city.trim() || 'Город пока не указан'}</Text>
                    </View>
                    <View style={styles.heroPill}>
                      <Text style={styles.heroPillText}>
                        {profile.skills.length > 0 ? `${profile.skills.length} навыков в профиле` : 'Навыки ещё не добавлены'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.max(completionPercent, 6)}%` }]} />
                  </View>

                  <View style={styles.heroActions}>
                    <Pressable onPress={() => openEditor('profile')} style={({ pressed }) => [styles.heroPrimaryButton, pressed && styles.pressed]}>
                      <Text style={styles.heroPrimaryText}>Редактировать профиль</Text>
                    </Pressable>
                    <Pressable onPress={openAvatarActions} style={({ pressed }) => [styles.heroSecondaryButton, pressed && styles.pressed]}>
                      <Text style={styles.heroSecondaryText}>{profile.avatarUrl ? 'Сменить фото' : 'Добавить фото'}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={styles.aiCard}>
                <View style={styles.aiGlowOne} />
                <View style={styles.aiGlowTwo} />
                <View style={styles.aiCopy}>
                  <Text style={styles.aiEyebrow}>AI guidance</Text>
                  <Text style={styles.aiTitle}>Помогите AI лучше понять вас</Text>
                  <Text style={styles.aiBody}>{aiText}</Text>
                  <Pressable onPress={() => openEditor('ai')} style={({ pressed }) => [styles.aiButton, pressed && styles.pressed]}>
                    <Text style={styles.aiButtonText}>{profile.aiAbout.trim() ? 'Обновить описание для AI' : 'Рассказать AI о себе'}</Text>
                  </Pressable>
                </View>
                <Image resizeMode="contain" source={ASSETS.ai} style={styles.aiArtwork} />
              </View>

              <View style={styles.sectionCard}>
                <SectionHeader
                  actionLabel="Изменить"
                  onPress={() => openEditor('skill')}
                  subtitle="Навыки сразу сохраняются в Firestore и используются в будущем AI-мэтчинге."
                  title="Навыки"
                />
                <View style={styles.chipsWrap}>
                  {profile.skills.length > 0 ? (
                    profile.skills.map((skill) => (
                      <Chip key={skill} label={skill} onRemove={() => void handleRemoveSkill(skill)} tint="blue" />
                    ))
                  ) : (
                    <View style={styles.emptyInline}>
                      <Text style={styles.emptyInlineText}>Навыков пока нет. Добавьте первый, чтобы профиль выглядел сильнее.</Text>
                    </View>
                  )}
                  <Pressable onPress={() => openEditor('skill')} style={({ pressed }) => [styles.addChip, pressed && styles.pressed]}>
                    <Text style={styles.addChipText}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={[styles.sectionCard, styles.sectionCardAlt]}>
                <SectionHeader
                  actionLabel="Изменить"
                  onPress={() => openEditor('interest')}
                  subtitle="Интересы помогают подбирать более близкие темы событий."
                  title="Интересы"
                />
                <View style={styles.chipsWrap}>
                  {profile.interests.length > 0 ? (
                    profile.interests.map((interest) => (
                      <Chip key={interest} label={interest} onRemove={() => void handleRemoveInterest(interest)} tint="mint" />
                    ))
                  ) : (
                    <View style={styles.emptyInline}>
                      <Text style={styles.emptyInlineText}>Интересы пока не заданы. Добавьте темы, которые вам действительно близки.</Text>
                    </View>
                  )}
                  <Pressable onPress={() => openEditor('interest')} style={({ pressed }) => [styles.addChip, styles.addChipMint, pressed && styles.pressed]}>
                    <Text style={[styles.addChipText, styles.addChipTextMint]}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.sectionCard}>
                <SectionHeader
                  subtitle="Никаких демо-значений: только реальные данные из participations и gratitude."
                  title="Волонтёрская статистика"
                />
                <View style={styles.statsGrid}>
                  <StatCard accent="blue" helper="Присоединений" icon={ASSETS.statEvents} label="События" value={String(stats.eventsJoined)} />
                  <StatCard accent="lavender" helper="Завершённых часов" icon={ASSETS.statHours} label="Часы" value={formatHours(stats.volunteerHours)} />
                  <StatCard accent="mint" helper="Отзывов и тепла" icon={ASSETS.statThanks} label="Благодарности" value={String(stats.thanksCount)} />
                  <StatCard
                    accent="warm"
                    fallback={<Text style={styles.statFallbackText}>OK</Text>}
                    helper="Доведено до конца"
                    label="Задачи"
                    value={String(stats.completedTasks)}
                  />
                </View>
              </View>

              <View style={styles.impactCard}>
                <View style={styles.impactCopy}>
                  <Text style={styles.impactEyebrow}>Impact & trust</Text>
                  <Text style={styles.impactTitle}>{insights.impactHeadline}</Text>
                  <Text style={styles.impactBody}>{insights.impactBody}</Text>
                  <View style={styles.impactPills}>
                    <View style={styles.impactPill}>
                      <View style={styles.impactDot} />
                      <Text style={styles.impactPillText}>{insights.reliabilityLabel}</Text>
                    </View>
                    <View style={styles.impactPill}>
                      <Text style={styles.impactPillText}>
                        {stats.monthlyImpactCount > 0 ? `${stats.monthlyImpactCount} активности в этом месяце` : 'Активность появится после первых завершений'}
                      </Text>
                    </View>
                  </View>
                </View>
                <Image resizeMode="contain" source={ASSETS.impact} style={styles.impactImage} />
              </View>

              <View style={styles.sectionCard}>
                <SectionHeader
                  subtitle="Собирается из реального профиля, участий и благодарностей."
                  title="Активность"
                />
                {insights.activityItems.map((item, index) => (
                  <View key={item.id} style={[styles.activityRow, index === insights.activityItems.length - 1 && styles.activityRowLast]}>
                    <View style={styles.activityTimeline}>
                      <View style={styles.activityDot} />
                      {index !== insights.activityItems.length - 1 ? <View style={styles.activityLine} /> : null}
                    </View>
                    <View style={styles.activityCopy}>
                      <Text style={styles.activityTitle}>{item.title}</Text>
                      <Text style={styles.activitySubtitle}>{item.subtitle}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        {showBottomBar ? (
          <View style={styles.bottomBar}>
            {TABS.map((item) => {
              const isActive = item.key === activeTab;

              return (
                <Pressable key={item.key} onPress={() => onSelectTab?.(item.key)} style={({ pressed }) => [styles.bottomTab, pressed && styles.pressed]}>
                  <Image
                    resizeMode="contain"
                    source={item.icon}
                    style={[styles.bottomTabIcon, !isActive && styles.bottomTabIconInactive]}
                  />
                  <Text style={[styles.bottomTabLabel, isActive && styles.bottomTabLabelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <EditorSheet
        loading={saving}
        onClose={closeEditor}
        onPrimaryPress={handleSaveProfile}
        primaryDisabled={!profileForm.fullName.trim()}
        primaryLabel="Сохранить"
        size="tall"
        subtitle="Имя, handle, город и короткая строка о вас сразу обновляются в Firebase."
        title="Редактировать профиль"
        visible={editorMode === 'profile'}
      >
        <Field
          autoCapitalize="words"
          label="Имя"
          onChangeText={(value) => setProfileForm((current) => ({ ...current, fullName: value }))}
          placeholder="Как к вам обращаться"
          value={profileForm.fullName}
        />
        <Field
          autoCapitalize="none"
          label="Handle"
          onChangeText={(value) => setProfileForm((current) => ({ ...current, handle: value }))}
          placeholder="@your.handle"
          value={profileForm.handle}
        />
        <Field
          autoCapitalize="words"
          label="Город"
          onChangeText={(value) => setProfileForm((current) => ({ ...current, city: value }))}
          placeholder="Например, Алматы"
          value={profileForm.city}
        />
        <Field
          label="Коротко о себе"
          multiline
          onChangeText={(value) => setProfileForm((current) => ({ ...current, bio: value }))}
          placeholder="Что вас характеризует как волонтёра"
          value={profileForm.bio}
        />
      </EditorSheet>

      <EditorSheet
        loading={saving}
        onClose={closeEditor}
        onPrimaryPress={handleSaveAi}
        primaryLabel="Сохранить"
        size="tall"
        subtitle="Это описание будет использоваться для будущих рекомендаций, мэтчинга и RAG-помощника."
        title="Рассказать AI о себе"
        visible={editorMode === 'ai'}
      >
        <Field
          label="Описание для AI"
          multiline
          onChangeText={setAiDraft}
          placeholder="Напишите, какие задачи вам ближе, в каких ролях вы сильны и что для вас важно"
          value={aiDraft}
        />
      </EditorSheet>

      <EditorSheet
        loading={saving}
        onClose={closeEditor}
        onPrimaryPress={handleAddChip}
        primaryDisabled={!chipDraft.trim()}
        primaryLabel="Добавить"
        size="compact"
        title={editorMode === 'skill' ? 'Добавить навык' : 'Добавить интерес'}
        visible={editorMode === 'skill' || editorMode === 'interest'}
      >
        <Field
          autoCapitalize="words"
          label={editorMode === 'skill' ? 'Навык' : 'Интерес'}
          onChangeText={setChipDraft}
          placeholder={editorMode === 'skill' ? 'Например, Коммуникация' : 'Например, Экология'}
          value={chipDraft}
        />
      </EditorSheet>
    </Root>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F8FC' },
  screen: { flex: 1, backgroundColor: '#F7F8FC' },
  content: { paddingHorizontal: 22, paddingTop: 10 },
  contentWithBar: { paddingBottom: 146 },
  contentEmbedded: { paddingBottom: 124 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  headerEyebrow: { fontSize: 12, fontWeight: '800', color: '#8E97BA', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 },
  headerTitle: { fontSize: 30, lineHeight: 34, fontWeight: '800', color: '#151B38' },
  headerActions: { flexDirection: 'row' },
  headerButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    shadowColor: '#2A336B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
  headerIconImage: { width: 24, height: 24 },
  menuGlyph: { width: 24, justifyContent: 'center', alignItems: 'center' },
  menuLine: { width: 18, height: 3, borderRadius: 999, backgroundColor: '#242C3E', marginVertical: 2 },
  errorBanner: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(196, 56, 76, 0.12)',
    backgroundColor: '#FFF3F5',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  errorText: { fontSize: 14, lineHeight: 20, color: '#B93D56', fontWeight: '600' },
  loadingCard: {
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 34,
    alignItems: 'center',
    shadowColor: '#2A336B',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.07,
    shadowRadius: 28,
    elevation: 6,
  },
  loadingTitle: { marginTop: 16, fontSize: 22, lineHeight: 28, fontWeight: '800', color: '#162041', textAlign: 'center' },
  loadingSubtitle: { marginTop: 10, fontSize: 14, lineHeight: 21, color: '#6A738F', textAlign: 'center' },
  heroWrap: { position: 'relative', paddingTop: 70, marginBottom: 18 },
  heroAuraLarge: { position: 'absolute', top: 20, left: 8, right: 8, height: 230, borderRadius: 120, backgroundColor: '#EEF1FF', opacity: 0.95 },
  heroAuraSoft: { position: 'absolute', top: 54, left: -8, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(222, 230, 255, 0.84)' },
  heroCard: {
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 86,
    paddingBottom: 24,
    alignItems: 'center',
    shadowColor: '#2A336B',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.08,
    shadowRadius: 32,
    elevation: 8,
  },
  avatarFrame: {
    position: 'absolute',
    top: -62,
    alignSelf: 'center',
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: '#FFF5E1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#9CADF4',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 6,
  },
  avatarButton: { width: 132, height: 132, borderRadius: 66 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 66 },
  avatarPlaceholder: { width: '100%', height: '100%', borderRadius: 66, backgroundColor: '#DCE5FF', alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 38, fontWeight: '800', color: '#4257D7' },
  avatarBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4B63F5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  avatarBadgeText: { color: '#FFFFFF', fontSize: 20, lineHeight: 20, fontWeight: '700', marginTop: -1 },
  completionBadge: { position: 'absolute', top: 24, right: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: '#F4F6FF', borderWidth: 1, borderColor: 'rgba(86, 106, 214, 0.08)' },
  completionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6AC08F', marginRight: 8 },
  completionText: { fontSize: 12, fontWeight: '700', color: '#4D5C9F' },
  profileName: { fontSize: 28, lineHeight: 32, fontWeight: '800', color: '#171D39', textAlign: 'center', marginBottom: 6 },
  profileHandle: { fontSize: 14, fontWeight: '700', color: '#7E88AC', marginBottom: 12 },
  profileBio: { fontSize: 15, lineHeight: 22, color: '#5E6784', textAlign: 'center', marginBottom: 18 },
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 },
  heroPill: { borderRadius: 999, backgroundColor: '#F7F8FC', paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 5, marginBottom: 10 },
  heroPillText: { fontSize: 12, fontWeight: '700', color: '#647093' },
  progressTrack: { width: '100%', height: 10, borderRadius: 999, backgroundColor: '#EEF1FF', overflow: 'hidden', marginBottom: 18 },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: '#7588F4' },
  heroActions: { width: '100%' },
  heroPrimaryButton: { minHeight: 50, borderRadius: 18, backgroundColor: '#4B63F5', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  heroPrimaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  heroSecondaryButton: { minHeight: 48, borderRadius: 18, backgroundColor: '#EEF1FF', alignItems: 'center', justifyContent: 'center' },
  heroSecondaryText: { fontSize: 14, fontWeight: '800', color: '#4860D7' },
  aiCard: { position: 'relative', flexDirection: 'row', alignItems: 'center', borderRadius: 30, backgroundColor: '#EEF2FF', overflow: 'hidden', paddingHorizontal: 20, paddingVertical: 20, marginBottom: 18 },
  aiGlowOne: { position: 'absolute', right: -34, bottom: -20, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(215, 223, 255, 0.8)' },
  aiGlowTwo: { position: 'absolute', left: -30, top: -20, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255, 255, 255, 0.58)' },
  aiCopy: { flex: 1, paddingRight: 14 },
  aiEyebrow: { fontSize: 12, fontWeight: '800', color: '#6B76B1', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 },
  aiTitle: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#131A38', marginBottom: 10 },
  aiBody: { fontSize: 14, lineHeight: 21, color: '#5A6485', marginBottom: 18 },
  aiButton: { alignSelf: 'flex-start', minHeight: 48, borderRadius: 18, paddingHorizontal: 18, backgroundColor: '#4A64F5', alignItems: 'center', justifyContent: 'center' },
  aiButtonText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  aiArtwork: { width: 88, height: 88 },
  sectionCard: { borderRadius: 28, backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingVertical: 18, marginBottom: 18, shadowColor: '#2A336B', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.06, shadowRadius: 28, elevation: 5 },
  sectionCardAlt: { backgroundColor: '#FEFFFE' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  sectionHeaderCopy: { flex: 1, paddingRight: 14 },
  sectionTitle: { fontSize: 24, lineHeight: 28, fontWeight: '800', color: '#151B38', marginBottom: 6 },
  sectionSubtitle: { fontSize: 13, lineHeight: 19, color: '#6E7897' },
  sectionAction: { minHeight: 40, borderRadius: 16, backgroundColor: '#EEF1FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sectionActionText: { fontSize: 14, fontWeight: '800', color: '#4560D8' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: '#F6F7FC', paddingLeft: 14, paddingRight: 10, paddingVertical: 10, marginRight: 10, marginBottom: 10 },
  chipMint: { backgroundColor: '#F1F8F3' },
  chipText: { fontSize: 14, fontWeight: '700', color: '#293255' },
  chipTextMint: { color: '#315E4B' },
  chipRemove: { marginLeft: 8, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  inlineIconText: { fontSize: 14, lineHeight: 14, fontWeight: '700', color: '#4960D7', marginTop: -1 },
  inlineIconTextMint: { color: '#3E7A57' },
  addChip: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF1FF', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  addChipMint: { backgroundColor: '#EDF7EE' },
  addChipText: { fontSize: 24, lineHeight: 24, fontWeight: '500', color: '#4B62D8', marginTop: -2 },
  addChipTextMint: { color: '#3F7A57' },
  emptyInline: { width: '100%', borderRadius: 20, backgroundColor: '#F7F8FC', paddingHorizontal: 14, paddingVertical: 14, marginBottom: 10 },
  emptyInlineText: { fontSize: 14, lineHeight: 20, color: '#6B7393' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: { width: '48.2%', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 12 },
  statBlue: { backgroundColor: '#EEF4FF' },
  statLavender: { backgroundColor: '#F2EEFF' },
  statMint: { backgroundColor: '#ECF8F1' },
  statWarm: { backgroundColor: '#FFF4EC' },
  statIconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  statIcon: { width: 24, height: 24 },
  statFallbackText: { fontSize: 12, lineHeight: 14, fontWeight: '800', color: '#B7773D' },
  statValue: { fontSize: 28, lineHeight: 32, fontWeight: '800', color: '#151B38', marginBottom: 4 },
  statLabel: { fontSize: 15, lineHeight: 19, fontWeight: '700', color: '#283155', marginBottom: 4 },
  statHelper: { fontSize: 12, lineHeight: 17, color: '#6A728F' },
  impactCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 30, backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingVertical: 20, marginBottom: 18, shadowColor: '#2A336B', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.06, shadowRadius: 28, elevation: 5 },
  impactCopy: { flex: 1, paddingRight: 14 },
  impactEyebrow: { fontSize: 12, fontWeight: '800', color: '#6F79B2', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 },
  impactTitle: { fontSize: 24, lineHeight: 29, fontWeight: '800', color: '#151B38', marginBottom: 10 },
  impactBody: { fontSize: 14, lineHeight: 21, color: '#606A89', marginBottom: 16 },
  impactPills: { flexDirection: 'row', flexWrap: 'wrap' },
  impactPill: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: '#F6F7FC', paddingHorizontal: 12, paddingVertical: 9, marginRight: 10, marginBottom: 10 },
  impactDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6CC293', marginRight: 8 },
  impactPillText: { fontSize: 12, fontWeight: '700', color: '#4E5A82' },
  impactImage: { width: 92, height: 92 },
  activityRow: { flexDirection: 'row', paddingBottom: 16 },
  activityRowLast: { paddingBottom: 0 },
  activityTimeline: { width: 20, alignItems: 'center' },
  activityDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#7587F3', marginTop: 4 },
  activityLine: { width: 2, flex: 1, backgroundColor: '#E1E5F4', marginTop: 8 },
  activityCopy: { flex: 1, paddingLeft: 12 },
  activityTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: '#1C2342', marginBottom: 5 },
  activitySubtitle: { fontSize: 13, lineHeight: 19, color: '#68728F' },
  bottomBar: { position: 'absolute', left: 18, right: 18, bottom: 18, borderRadius: 28, backgroundColor: '#FBFBFF', borderWidth: 1, borderColor: 'rgba(22, 30, 70, 0.05)', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 12, paddingBottom: 10, shadowColor: '#1D2552', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.14, shadowRadius: 28, elevation: 16 },
  bottomTab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minHeight: 58 },
  bottomTabIcon: { width: 34, height: 34, marginBottom: 6 },
  bottomTabIconInactive: { opacity: 0.62 },
  bottomTabLabel: { fontSize: 11, fontWeight: '700', color: '#7A819D', textAlign: 'center', maxWidth: 72, minHeight: 14 },
  bottomTabLabelActive: { color: '#E17882' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(16, 21, 44, 0.32)', justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject },
  sheetKeyboard: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  sheet: { flexShrink: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  sheetTall: { minHeight: '76%', maxHeight: '94%' },
  sheetCompact: { minHeight: '46%', maxHeight: '62%' },
  sheetHandle: { alignSelf: 'center', width: 56, height: 5, borderRadius: 999, backgroundColor: '#D7DCEF', marginBottom: 14 },
  sheetTitle: { fontSize: 24, lineHeight: 28, fontWeight: '800', color: '#151B38', marginBottom: 8 },
  sheetSubtitle: { fontSize: 14, lineHeight: 21, color: '#697394', marginBottom: 16 },
  sheetContent: { flex: 1, paddingBottom: 18 },
  sheetActions: { flexDirection: 'row', marginTop: 'auto', paddingTop: 14 },
  sheetGhostButton: { flex: 1, minHeight: 50, borderRadius: 18, backgroundColor: '#F5F6FB', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  sheetGhostText: { fontSize: 15, fontWeight: '800', color: '#60709A' },
  sheetPrimaryButton: { flex: 1.2, minHeight: 50, borderRadius: 18, backgroundColor: '#4B63F5', alignItems: 'center', justifyContent: 'center' },
  sheetPrimaryButtonDisabled: { opacity: 0.45 },
  sheetPrimaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: '#4B5478', marginBottom: 8 },
  fieldInput: { minHeight: 50, borderRadius: 18, backgroundColor: '#F7F8FC', paddingHorizontal: 14, fontSize: 15, color: '#151B38' },
  fieldInputMultiline: { minHeight: 118, paddingTop: 14, paddingBottom: 14 },
  pressed: { opacity: 0.9 },
});
