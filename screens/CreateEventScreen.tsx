import React, { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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

import { getCurrentUser } from '../services/authService';
import { FALLBACK_EVENT_IMAGE, createEvent } from '../services/eventService';
import { parseRawEventInput } from '../services/openaiService';
import { UserRole } from '../types/auth';
import { CreateEventInput, EventAiAnswerMap, EventCategory } from '../types/event';

type CreateEventScreenProps = {
  currentUserRole?: UserRole;
  onClose?: () => void;
  onPublished?: () => void;
  navigation?: {
    goBack?: () => void;
  };
};

type CategoryOption = {
  key: Exclude<EventCategory, 'All'>;
  emoji: string;
  label: string;
};

type ImageSourceMode = 'url' | 'gallery';

type EventAiQuestion = {
  id: string;
  question: string;
  options: string[];
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  { key: 'Design', emoji: '🎨', label: 'Дизайн' },
  { key: 'IT', emoji: '💻', label: 'IT' },
  { key: 'Environment', emoji: '🌿', label: 'Экология' },
  { key: 'Social', emoji: '🤝', label: 'Социальное' },
];

const EVENT_AI_QUESTIONS: EventAiQuestion[] = [
  {
    id: 'event-goal',
    question: 'Какая главная цель у этого объявления?',
    options: ['Быстро собрать команду', 'Найти точных людей под задачу', 'Рассказать о миссии'],
  },
  {
    id: 'help-format',
    question: 'Какой формат помощи нужен сильнее всего?',
    options: ['Физическая помощь', 'Коммуникации и медиа', 'Организация и координация'],
  },
  {
    id: 'volunteer-type',
    question: 'Кто лучше всего подойдёт на это событие?',
    options: ['Новички', 'Опытные волонтёры', 'Смешанная команда'],
  },
  {
    id: 'energy-level',
    question: 'Какой ритм участия ожидается?',
    options: ['Спокойный и поддерживающий', 'Активный и быстрый', 'Гибкий по ситуации'],
  },
  {
    id: 'success-signal',
    question: 'Что будет означать, что событие прошло успешно?',
    options: ['Нужное число людей пришло', 'Задача закрыта качественно', 'Люди захотят вернуться ещё'],
  },
];

const parseCommaSeparatedValues = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const FormInput = ({
  label,
  multiline,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) => (
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      {...props}
      multiline={multiline}
      placeholderTextColor="rgba(40, 44, 68, 0.35)"
      style={[styles.input, multiline && styles.multilineInput]}
    />
  </View>
);

export default function CreateEventScreen({
  currentUserRole = 'organization',
  onClose,
  onPublished,
  navigation,
}: CreateEventScreenProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Exclude<EventCategory, 'All'> | ''>('');
  const [tagsInput, setTagsInput] = useState('');
  const [date, setDate] = useState('');
  const [duration, setDuration] = useState('');
  const [location, setLocation] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [eventAiAnswers, setEventAiAnswers] = useState<EventAiAnswerMap>({});
  const [imageSourceMode, setImageSourceMode] = useState<ImageSourceMode>('url');
  const [imageUrl, setImageUrl] = useState('');
  const [pickedImageUri, setPickedImageUri] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const parsedTags = parseCommaSeparatedValues(tagsInput);
  const aiAnswersSummary = Object.entries(eventAiAnswers)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}: ${value.trim()}`)
    .join('\n');
  const combinedAiContext = [rawInput.trim(), aiAnswersSummary ? `AI answers:\n${aiAnswersSummary}` : '']
    .filter(Boolean)
    .join('\n\n');
  const previewImageUri =
    imageSourceMode === 'gallery'
      ? pickedImageUri || FALLBACK_EVENT_IMAGE
      : imageUrl.trim() || FALLBACK_EVENT_IMAGE;

  const closeScreen = () => {
    if (navigation?.goBack) {
      navigation.goBack();
      return;
    }

    onClose?.();
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('');
    setTagsInput('');
    setDate('');
    setDuration('');
    setLocation('');
    setRawInput('');
    setEventAiAnswers({});
    setImageSourceMode('url');
    setImageUrl('');
    setPickedImageUri('');
    setError(null);
    setAiError(null);
  };

  const validateForm = () => {
    if (currentUserRole !== 'organization') {
      return 'Только организации могут публиковать события.';
    }

    if (!title.trim() || !description.trim() || !category || !date.trim() || !duration.trim()) {
      return 'Заполните название, описание, категорию, дату и длительность.';
    }

    return null;
  };

  const handleEventAiAnswerChange = (questionId: string, value: string) => {
    setEventAiAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  };

  const handlePickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        setError('Разрешите доступ к галерее, чтобы выбрать изображение для события.');
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (pickerResult.canceled || !pickerResult.assets?.[0]?.uri) {
        return;
      }

      setPickedImageUri(pickerResult.assets[0].uri);
      setImageSourceMode('gallery');
      setError(null);
    } catch {
      setError('Не удалось открыть галерею. Попробуйте ещё раз.');
    }
  };

  const handleAiParse = async () => {
    if (!combinedAiContext.trim()) {
      setAiError('Сначала опишите идею события в свободной форме.');
      return;
    }

    setIsAiParsing(true);
    setAiError(null);

    try {
      const parsed = await parseRawEventInput(combinedAiContext);

      setTitle((current) => current || parsed.title);
      setDescription((current) => current || parsed.description);
      setCategory((current) => current || parsed.category);
      setTagsInput((current) => current || parsed.tags.join(', '));
      setDate((current) => current || parsed.date);
      setDuration((current) => current || parsed.duration);
      setLocation((current) => current || parsed.location);
      setError(null);
    } catch (serviceError) {
      setAiError(
        serviceError instanceof Error
          ? serviceError.message
          : 'AI не смог разобрать черновик события. Попробуйте ещё раз.',
      );
    } finally {
      setIsAiParsing(false);
    }
  };

  const handlePublish = async () => {
    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    const currentUser = getCurrentUser();

    if (!currentUser) {
      setError('Сначала войдите в аккаунт организации, чтобы публиковать события.');
      return;
    }

    const payload: CreateEventInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      tags: parsedTags,
      date: date.trim(),
      duration: duration.trim(),
      location: location.trim(),
      imageUrl: imageSourceMode === 'gallery' ? pickedImageUri.trim() : imageUrl.trim(),
      rawInput: combinedAiContext || undefined,
      aiQuestionnaireAnswers: eventAiAnswers,
      // TODO: upload picked gallery images to Firebase Storage and persist a public URL instead of a local file URI.
    };

    setIsSubmitting(true);
    setError(null);

    try {
      await createEvent(payload, currentUser);
      resetForm();
      Alert.alert('Событие опубликовано', 'Новая волонтёрская возможность уже появилась в общей ленте.');
      onPublished?.();
      closeScreen();
    } catch (serviceError) {
      setError(serviceError instanceof Error ? serviceError.message : 'Не удалось опубликовать событие.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Pressable onPress={closeScreen} style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}>
                <Text style={styles.headerArrow}>←</Text>
              </Pressable>

              <View style={styles.headerTextBlock}>
                <Text style={styles.title}>Создать событие</Text>
                <Text style={styles.subtitle}>Опубликуйте новую волонтёрскую возможность для сообщества Volunet.</Text>
              </View>
            </View>

            <View style={styles.heroCard}>
              <Image
                source={{ uri: previewImageUri }}
                style={styles.heroImage}
              />

              <View style={styles.heroOverlay}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>Новая публикация</Text>
                </View>
                <Text style={styles.heroTitle}>{title.trim() || 'Как будет выглядеть карточка события'}</Text>
                <Text numberOfLines={2} style={styles.heroSubtitle}>
                  {description.trim() || 'Добавьте короткое и понятное описание, чтобы волонтёры сразу увидели ценность события.'}
                </Text>
              </View>
            </View>

            <View style={styles.formCard}>
              {error ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.aiDraftCard}>
                <View style={styles.aiDraftHeader}>
                  <View style={styles.aiDraftCopy}>
                    <Text style={styles.aiDraftTitle}>AI-черновик события</Text>
                    <Text style={styles.aiDraftSubtitle}>
                      Опишите идею в свободной форме, и AI заполнит основные поля формы.
                    </Text>
                  </View>
                  <View style={styles.aiDraftBadge}>
                    <Text style={styles.aiDraftBadgeText}>AI</Text>
                  </View>
                </View>

                <TextInput
                  editable={!isSubmitting && !isAiParsing}
                  multiline
                  onChangeText={setRawInput}
                  placeholder="Например: хотим провести субботник в парке, нужны волонтёры на выходных, помощь с уборкой, регистрацией и фото..."
                  placeholderTextColor="rgba(40, 44, 68, 0.35)"
                  style={styles.aiDraftInput}
                  textAlignVertical="top"
                  value={rawInput}
                />

                {aiError ? (
                  <View style={styles.aiInlineError}>
                    <Text style={styles.aiInlineErrorText}>{aiError}</Text>
                  </View>
                ) : null}

                <Pressable
                  disabled={isSubmitting || isAiParsing}
                  onPress={() => void handleAiParse()}
                  style={({ pressed }) => [
                    styles.aiDraftButton,
                    (isSubmitting || isAiParsing) && styles.aiDraftButtonDisabled,
                    pressed && !isSubmitting && !isAiParsing && styles.pressed,
                  ]}
                >
                  {isAiParsing ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.aiDraftButtonText}>Заполнить форму с AI</Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.aiQuestionnaireCard}>
                <Text style={styles.aiQuestionnaireTitle}>AI-вопросы по объявлению</Text>
                <Text style={styles.aiQuestionnaireSubtitle}>
                  Быстрые ответы помогут AI точнее понять событие ещё до публикации.
                </Text>

                {EVENT_AI_QUESTIONS.map((item) => (
                  <View key={item.id} style={styles.aiQuestionnaireBlock}>
                    <Text style={styles.aiQuestionnairePrompt}>{item.question}</Text>

                    <View style={styles.aiQuestionnaireOptionsWrap}>
                      {item.options.map((option) => {
                        const selected = eventAiAnswers[item.id] === option;

                        return (
                          <Pressable
                            key={`${item.id}-${option}`}
                            onPress={() => handleEventAiAnswerChange(item.id, option)}
                            style={({ pressed }) => [
                              styles.aiQuestionnaireOption,
                              selected && styles.aiQuestionnaireOptionSelected,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text
                              style={[
                                styles.aiQuestionnaireOptionText,
                                selected && styles.aiQuestionnaireOptionTextSelected,
                              ]}
                            >
                              {option}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <TextInput
                      editable={!isSubmitting}
                      onChangeText={(value) => handleEventAiAnswerChange(item.id, value)}
                      placeholder="Или свой вариант"
                      placeholderTextColor="rgba(40, 44, 68, 0.35)"
                      style={styles.aiQuestionnaireInput}
                      value={eventAiAnswers[item.id] ?? ''}
                    />
                  </View>
                ))}
              </View>

              <FormInput
                editable={!isSubmitting}
                label="Название"
                onChangeText={setTitle}
                placeholder="Например: Эко-субботник в городском парке"
                value={title}
              />

              <FormInput
                editable={!isSubmitting}
                label="Описание"
                multiline
                onChangeText={setDescription}
                placeholder="Кого вы ищете, зачем проводится событие и чем будут заниматься волонтёры?"
                value={description}
              />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Категория</Text>
                <View style={styles.categoryRow}>
                  {CATEGORY_OPTIONS.map((item) => {
                    const selected = category === item.key;

                    return (
                      <Pressable
                        disabled={isSubmitting}
                        key={item.key}
                        onPress={() => setCategory(item.key)}
                        style={({ pressed }) => [
                          styles.categoryChip,
                          selected && styles.categoryChipSelected,
                          pressed && !isSubmitting && styles.pressed,
                        ]}
                      >
                        <Text style={styles.categoryEmoji}>{item.emoji}</Text>
                        <Text style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <FormInput
                editable={!isSubmitting}
                label="Теги"
                onChangeText={setTagsInput}
                placeholder="дети, дизайн, маркетинг"
                value={tagsInput}
              />

              {parsedTags.length > 0 ? (
                <View style={styles.previewChips}>
                  {parsedTags.map((tag) => (
                    <View key={tag} style={styles.previewChip}>
                      <Text style={styles.previewChipText}>#{tag}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <FormInput
                    editable={!isSubmitting}
                    label="Дата"
                    onChangeText={setDate}
                    placeholder="12 мая 2026 14:00"
                    value={date}
                  />
                </View>
                <View style={styles.rowItem}>
                  <FormInput
                    editable={!isSubmitting}
                    label="Длительность"
                    onChangeText={setDuration}
                    placeholder="3 часа"
                    value={duration}
                  />
                </View>
              </View>

              <FormInput
                editable={!isSubmitting}
                label="Локация"
                onChangeText={setLocation}
                placeholder="Алматы, Центральный парк"
                value={location}
              />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Изображение</Text>

                <View style={styles.imageModeRow}>
                  <Pressable
                    disabled={isSubmitting}
                    onPress={() => setImageSourceMode('url')}
                    style={({ pressed }) => [
                      styles.imageModeButton,
                      imageSourceMode === 'url' && styles.imageModeButtonSelected,
                      pressed && !isSubmitting && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.imageModeButtonText,
                        imageSourceMode === 'url' && styles.imageModeButtonTextSelected,
                      ]}
                    >
                      По ссылке
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={isSubmitting}
                    onPress={() => setImageSourceMode('gallery')}
                    style={({ pressed }) => [
                      styles.imageModeButton,
                      styles.imageModeButtonLast,
                      imageSourceMode === 'gallery' && styles.imageModeButtonSelected,
                      pressed && !isSubmitting && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.imageModeButtonText,
                        imageSourceMode === 'gallery' && styles.imageModeButtonTextSelected,
                      ]}
                    >
                      Из галереи
                    </Text>
                  </Pressable>
                </View>

                {imageSourceMode === 'url' ? (
                  <FormInput
                    autoCapitalize="none"
                    editable={!isSubmitting}
                    label="Ссылка на изображение"
                    onChangeText={setImageUrl}
                    placeholder="https://..."
                    value={imageUrl}
                  />
                ) : (
                  <View style={styles.imagePickerCard}>
                    <Text style={styles.imagePickerTitle}>Выберите изображение с телефона</Text>
                    <Text style={styles.imagePickerHint}>
                      Можно взять фото из галереи, а позже мы загрузим его в Storage автоматически.
                    </Text>

                    <View style={styles.imagePickerActions}>
                      <Pressable
                        disabled={isSubmitting}
                        onPress={handlePickImage}
                        style={({ pressed }) => [
                          styles.galleryButton,
                          pressed && !isSubmitting && styles.pressed,
                        ]}
                      >
                        <Text style={styles.galleryButtonText}>
                          {pickedImageUri ? 'Выбрать другое изображение' : 'Загрузить своё изображение'}
                        </Text>
                      </Pressable>

                      {pickedImageUri ? (
                        <Pressable
                          disabled={isSubmitting}
                          onPress={() => setPickedImageUri('')}
                          style={({ pressed }) => [
                            styles.galleryGhostButton,
                            pressed && !isSubmitting && styles.pressed,
                          ]}
                        >
                          <Text style={styles.galleryGhostButtonText}>Убрать</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    {pickedImageUri ? (
                      <Text numberOfLines={1} style={styles.imagePickerPath}>
                        {pickedImageUri}
                      </Text>
                    ) : null}
                  </View>
                )}

                <View style={styles.aiHintCard}>
                  <Text style={styles.aiHintTitle}>AI-метки появятся позже</Text>
                  <Text style={styles.aiHintText}>
                    Популярность и рекомендации будут определяться автоматически после AI-анализа события.
                  </Text>
                </View>
              </View>

              <Pressable
                disabled={isSubmitting}
                onPress={handlePublish}
                style={({ pressed }) => [
                  styles.submitButton,
                  isSubmitting && styles.submitButtonDisabled,
                  pressed && !isSubmitting && styles.pressed,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.submitIcon}>✦</Text>
                    <Text style={styles.submitButtonText}>Опубликовать событие</Text>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F5F8',
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
    paddingTop: 8,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginRight: 14,
  },
  headerTextBlock: {
    flex: 1,
    paddingTop: 2,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0E132F',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5B6385',
  },
  heroCard: {
    height: 220,
    borderRadius: 30,
    overflow: 'hidden',
    marginBottom: 18,
    backgroundColor: '#D7DCF8',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 20,
    backgroundColor: 'rgba(15, 19, 47, 0.28)',
  },
  heroBadge: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E2450',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  formCard: {
    borderRadius: 30,
    padding: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#21295A',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
  },
  errorBanner: {
    marginBottom: 16,
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
  aiDraftCard: {
    marginBottom: 20,
    borderRadius: 24,
    padding: 16,
    backgroundColor: '#F5F7FF',
    borderWidth: 1,
    borderColor: '#E2E8FF',
  },
  aiDraftHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  aiDraftCopy: {
    flex: 1,
    paddingRight: 12,
  },
  aiDraftTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#16204D',
    marginBottom: 4,
  },
  aiDraftSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#697196',
  },
  aiDraftBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E1E7FF',
  },
  aiDraftBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#3450E6',
    letterSpacing: 0.6,
  },
  aiDraftInput: {
    minHeight: 118,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DFE5FA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    lineHeight: 21,
    color: '#11152F',
    marginBottom: 12,
  },
  aiInlineError: {
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: '#FFF1F3',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  aiInlineErrorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#B3374E',
    fontWeight: '600',
  },
  aiDraftButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3F58E0',
  },
  aiDraftButtonDisabled: {
    opacity: 0.7,
  },
  aiDraftButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  aiQuestionnaireCard: {
    marginBottom: 20,
    borderRadius: 24,
    padding: 16,
    backgroundColor: '#F8F9FF',
    borderWidth: 1,
    borderColor: '#E6EAFB',
  },
  aiQuestionnaireTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#16204D',
    marginBottom: 4,
  },
  aiQuestionnaireSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#697196',
    marginBottom: 14,
  },
  aiQuestionnaireBlock: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  aiQuestionnairePrompt: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    color: '#1A2147',
    marginBottom: 10,
  },
  aiQuestionnaireOptionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  aiQuestionnaireOption: {
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  aiQuestionnaireOptionSelected: {
    backgroundColor: '#3F58E0',
  },
  aiQuestionnaireOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3B486F',
  },
  aiQuestionnaireOptionTextSelected: {
    color: '#FFFFFF',
  },
  aiQuestionnaireInput: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4E8F6',
    backgroundColor: '#F9FAFD',
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#11152F',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A2147',
    marginBottom: 9,
  },
  input: {
    minHeight: 56,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8EBF3',
    backgroundColor: '#F8F9FC',
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#11152F',
  },
  multilineInput: {
    minHeight: 124,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  categoryChip: {
    minWidth: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#F7F8FC',
    borderWidth: 1,
    borderColor: '#ECEFF5',
    marginRight: '3%',
    marginBottom: 10,
  },
  categoryChipSelected: {
    backgroundColor: '#EAF0FF',
    borderColor: '#4A64F5',
  },
  categoryEmoji: {
    fontSize: 18,
    marginRight: 10,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#263056',
  },
  categoryLabelSelected: {
    color: '#2441D7',
  },
  previewChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: -4,
    marginBottom: 10,
  },
  previewChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    marginRight: 8,
    marginBottom: 8,
  },
  previewChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3250E0',
  },
  row: {
    flexDirection: 'row',
  },
  rowItem: {
    flex: 1,
    marginRight: 10,
  },
  imageModeRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  imageModeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E9F3',
    backgroundColor: '#F8F9FC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  imageModeButtonLast: {
    marginRight: 0,
  },
  imageModeButtonSelected: {
    backgroundColor: '#EAF0FF',
    borderColor: '#4A64F5',
  },
  imageModeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#5B6385',
  },
  imageModeButtonTextSelected: {
    color: '#2441D7',
  },
  imagePickerCard: {
    borderRadius: 24,
    backgroundColor: '#F7F8FC',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 14,
  },
  imagePickerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#18204A',
    marginBottom: 6,
  },
  imagePickerHint: {
    fontSize: 13,
    lineHeight: 19,
    color: '#667090',
    marginBottom: 14,
  },
  imagePickerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  galleryButton: {
    minHeight: 46,
    borderRadius: 18,
    paddingHorizontal: 16,
    backgroundColor: '#10183A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  galleryGhostButton: {
    minHeight: 46,
    borderRadius: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#D8DEEC',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  galleryGhostButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4050A8',
  },
  imagePickerPath: {
    marginTop: 12,
    fontSize: 12,
    color: '#6C7391',
  },
  aiHintCard: {
    borderRadius: 22,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 18,
  },
  aiHintTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2339CA',
    marginBottom: 4,
  },
  aiHintText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#495785',
  },
  submitButton: {
    minHeight: 58,
    borderRadius: 22,
    backgroundColor: '#10183A',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginLeft: 10,
  },
  headerArrow: {
    fontSize: 22,
    color: '#151933',
    fontWeight: '700',
  },
  submitIcon: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.9,
  },
});
