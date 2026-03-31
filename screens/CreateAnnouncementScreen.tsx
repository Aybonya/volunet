import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { createEventAnnouncement } from '../services/eventService';
import { EventItem } from '../types/event';

type CreateAnnouncementScreenProps = {
  event: EventItem;
  recipientCount: number;
  onClose?: () => void;
  onPublished?: () => void;
};

const Field = ({
  label,
  multiline,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) => (
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      {...props}
      multiline={multiline}
      placeholderTextColor="rgba(35, 43, 82, 0.34)"
      style={[styles.input, multiline && styles.multilineInput]}
    />
  </View>
);

export default function CreateAnnouncementScreen({
  event,
  recipientCount,
  onClose,
  onPublished,
}: CreateAnnouncementScreenProps) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const messagePreview = useMemo(() => {
    if (message.trim()) {
      return message.trim();
    }

    return 'Напишите короткое и понятное сообщение для всех, кто записался на это событие.';
  }, [message]);

  const closeScreen = () => {
    onClose?.();
  };

  const validate = () => {
    if (!title.trim() || !message.trim()) {
      return 'Заполните тему и текст сообщения.';
    }

    if (recipientCount === 0) {
      return 'Пока некому отправлять сообщение: на событие ещё никто не записался.';
    }

    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    const currentUser = getCurrentUser();

    if (!currentUser) {
      setError('Сначала войдите в аккаунт организации.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      await createEventAnnouncement(
        {
          eventId: event.id,
          eventTitle: event.title,
          title: title.trim(),
          message: message.trim(),
        },
        currentUser,
      );

      onPublished?.();
      closeScreen();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось отправить сообщение.');
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
              <Pressable onPress={closeScreen} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
                <Text style={styles.headerArrow}>←</Text>
              </Pressable>

              <View style={styles.headerCopy}>
                <Text style={styles.title}>Сообщение участникам</Text>
              </View>
            </View>

            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>Рассылка</Text>
                </View>
                <View style={styles.heroCountBadge}>
                  <Text style={styles.heroCountBadgeText}>{recipientCount}</Text>
                </View>
              </View>

              <Text style={styles.heroTitle}>{event.title}</Text>
              <Text style={styles.heroMeta}>
                {[event.date, event.location].filter(Boolean).join(' • ') || 'Событие уже готово к коммуникации'}
              </Text>

              <View style={styles.previewCard}>
                <Text style={styles.previewLabel}>Предпросмотр</Text>
                <Text style={styles.previewHeadline}>{title.trim() || 'Тема сообщения'}</Text>
                <Text style={styles.previewText}>{messagePreview}</Text>
              </View>
            </View>

            <View style={styles.formCard}>
              {error ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Field
                editable={!isSubmitting}
                label="Тема"
                onChangeText={setTitle}
                placeholder="Например: Важное обновление по сбору"
                value={title}
              />

              <Field
                editable={!isSubmitting}
                label="Сообщение"
                multiline
                onChangeText={setMessage}
                placeholder="Напишите детали для всех участников: во сколько сбор, что взять с собой, на что обратить внимание..."
                value={message}
              />

              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>Кому уйдёт сообщение</Text>
                <Text style={styles.infoText}>
                  Сообщение сохранится в Firebase и будет привязано к этому событию для всех {recipientCount}{' '}
                  зарегистрированных волонтёров.
                </Text>
              </View>

              <Pressable
                disabled={isSubmitting}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.submitButton,
                  isSubmitting && styles.submitButtonDisabled,
                  pressed && !isSubmitting && styles.pressed,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>Отправить сообщение</Text>
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
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginRight: 14,
  },
  headerArrow: {
    fontSize: 22,
    color: '#151933',
    fontWeight: '700',
  },
  headerCopy: {
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
    borderRadius: 30,
    backgroundColor: '#DDE4FF',
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 18,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2D3FC7',
  },
  heroCountBadge: {
    minWidth: 38,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#10183A',
    alignItems: 'center',
  },
  heroCountBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    color: '#11183A',
    marginBottom: 8,
  },
  heroMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#5E6687',
    marginBottom: 16,
  },
  previewCard: {
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#4452A7',
    marginBottom: 8,
  },
  previewHeadline: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    color: '#152042',
    marginBottom: 8,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5B6385',
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
    minHeight: 168,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  infoCard: {
    borderRadius: 22,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 18,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2339CA',
    marginBottom: 4,
  },
  infoText: {
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
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.9,
  },
});
