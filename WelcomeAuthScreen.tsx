import React, { ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  TouchableWithoutFeedback,
  View,
  ViewStyle,
  findNodeHandle,
} from 'react-native';

import { login as loginUser, signUpOrganization, signUpVolunteer } from './services/authService';
import { OrganizationSignupInput, VolunteerSignupInput } from './types/auth';

type AuthMode = 'volunteer' | 'organization' | 'login' | null;
type BottomSheetMode = Exclude<AuthMode, null>;

type VolunteerFormState = Omit<VolunteerSignupInput, 'role'>;
type OrganizationFormState = Omit<OrganizationSignupInput, 'role'>;

type LoginFormState = { email: string; password: string; rememberMe: boolean };

type ButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

type AuthInputProps = TextInputProps & {
  label: string;
  containerStyle?: StyleProp<ViewStyle>;
};

type ChipSelectorProps = {
  label: string;
  options: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
};

type BottomSheetModalProps = {
  mode: AuthMode;
  onClose: () => void;
  children: (mode: BottomSheetMode) => ReactNode;
};

type BottomSheetKeyboardContextValue = {
  onInputFocus: (target: number | null) => void;
};

const BottomSheetKeyboardContext = createContext<BottomSheetKeyboardContextValue>({
  onInputFocus: () => {},
});

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const VOLUNTEER_SKILLS = ['коммуникация', 'обучение', 'организация', 'SMM', 'дизайн'];
const VOLUNTEER_INTERESTS = ['Наставничество', 'Мероприятия', 'Фандрайзинг', 'Технологии', 'Творчество'];
const VOLUNTEER_CAUSES = ['Экология', 'Образование', 'Животные', 'Здоровье', 'Сообщество'];
const VOLUNTEER_AVAILABILITY = ['Выходные', 'Вечера', 'Гибкий график'];
const ORGANIZATION_TYPES = ['НКО', 'Школа', 'Фонд', 'Сообщество', 'Социальное предприятие'];
const ORGANIZATION_FOCUS_AREAS = ['Образование', 'Экология', 'Животные', 'Здоровье', 'Сообщество'];
const TITLE_FONT_FAMILY = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createVolunteerFormState = (): VolunteerFormState => ({
  fullName: '',
  email: '',
  password: '',
  city: '',
  bio: '',
  skills: [],
  interests: [],
  causes: [],
  availability: [],
});

const createOrganizationFormState = (): OrganizationFormState => ({
  organizationName: '',
  contactPerson: '',
  email: '',
  password: '',
  location: '',
  organizationType: '',
  focusAreas: [],
  description: '',
});

const createLoginFormState = (): LoginFormState => ({ email: '', password: '', rememberMe: false });
const normalizeSelections = (values: string[]) => values.map((value) => value.trim()).filter(Boolean);

const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());

const buildVolunteerPayload = (form: VolunteerFormState): VolunteerSignupInput => ({
  role: 'volunteer',
  fullName: form.fullName.trim(),
  email: form.email.trim(),
  password: form.password,
  city: form.city.trim(),
  bio: form.bio.trim(),
  skills: normalizeSelections(form.skills),
  interests: normalizeSelections(form.interests),
  causes: normalizeSelections(form.causes),
  availability: normalizeSelections(form.availability),
});

const buildOrganizationPayload = (form: OrganizationFormState): OrganizationSignupInput => ({
  role: 'organization',
  organizationName: form.organizationName.trim(),
  contactPerson: form.contactPerson.trim(),
  email: form.email.trim(),
  password: form.password,
  location: form.location.trim(),
  organizationType: form.organizationType.trim(),
  focusAreas: normalizeSelections(form.focusAreas),
  description: form.description.trim(),
});

const PrimaryButton = ({ title, onPress, disabled, style, textStyle }: ButtonProps) => (
  <Pressable
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.primaryButton,
      disabled && styles.buttonDisabled,
      pressed && !disabled && styles.buttonPressed,
      style,
    ]}
  >
    <Text style={[styles.primaryButtonText, textStyle]}>{title}</Text>
  </Pressable>
);

const SecondaryButton = ({ title, onPress, disabled, style, textStyle }: ButtonProps) => (
  <Pressable
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.secondaryButton,
      disabled && styles.buttonDisabled,
      pressed && !disabled && styles.buttonPressed,
      style,
    ]}
  >
    <Text style={[styles.secondaryButtonText, textStyle]}>{title}</Text>
  </Pressable>
);

const AuthInput = ({ label, containerStyle, multiline, style, onFocus, ...props }: AuthInputProps) => {
  const { onInputFocus } = useContext(BottomSheetKeyboardContext);

  const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
    onInputFocus((event as { nativeEvent?: { target?: number } }).nativeEvent?.target ?? null);
    onFocus?.(event);
  };

  return (
    <View style={[styles.inputGroup, containerStyle]}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        onFocus={handleFocus}
        placeholderTextColor="rgba(58, 66, 103, 0.45)"
        style={[styles.input, multiline && styles.multilineInput, style]}
      />
    </View>
  );
};

const ChipSelector = ({
  label,
  options,
  selectedValues,
  onChange,
  multiple = true,
  disabled = false,
}: ChipSelectorProps) => {
  const toggleOption = (option: string) => {
    if (disabled) {
      return;
    }

    const isSelected = selectedValues.includes(option);
    if (!multiple) {
      onChange(isSelected ? [] : [option]);
      return;
    }
    onChange(isSelected ? selectedValues.filter((value) => value !== option) : [...selectedValues, option]);
  };

  return (
    <View style={styles.selectorGroup}>
      <Text style={styles.selectorLabel}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((option) => {
          const selected = selectedValues.includes(option);
          return (
            <Pressable
              disabled={disabled}
              key={option}
              onPress={() => toggleOption(option)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                disabled && styles.chipDisabled,
                pressed && !disabled && styles.chipPressed,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const BottomSheetModal = ({ mode, onClose, children }: BottomSheetModalProps) => {
  const [mounted, setMounted] = useState(Boolean(mode));
  const [activeMode, setActiveMode] = useState<BottomSheetMode | null>(mode);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.98)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const dragStartY = useRef(0);
  const baseSheetHeight = Math.min(SCREEN_HEIGHT * 0.78, 740);
  const expandedSheetHeight = Math.min(SCREEN_HEIGHT * 0.9, SCREEN_HEIGHT - 18);
  const effectiveSheetHeight = keyboardInset > 0 ? expandedSheetHeight : baseSheetHeight;
  const hiddenSheetOffset = expandedSheetHeight;
  const closeThreshold = Math.max(120, effectiveSheetHeight * 0.18);

  const animateSheetToOpen = () => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 10, tension: 88, useNativeDriver: true }),
      Animated.timing(modalScale, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  };

  const animateSheetBack = () => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 10, tension: 88, useNativeDriver: true }),
      Animated.timing(modalScale, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  };

  const scrollToFocusedInput = (target: number | null) => {
    if (!target || !scrollViewRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollViewRef.current?.scrollResponderScrollNativeHandleToKeyboard(target, 132, true);
      }, Platform.OS === 'android' ? 140 : 60);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
      onPanResponderGrant: () => {
        Keyboard.dismiss();
        translateY.stopAnimation((value) => {
          dragStartY.current = value;
        });
      },
      onPanResponderMove: (_, gestureState) => {
        const nextTranslate = Math.max(0, dragStartY.current + gestureState.dy);
        const backdropValue = Math.max(0, 1 - nextTranslate / hiddenSheetOffset);
        const scaleValue = Math.max(0.96, 1 - nextTranslate / (hiddenSheetOffset * 3));

        translateY.setValue(nextTranslate);
        backdropOpacity.setValue(backdropValue);
        modalScale.setValue(scaleValue);
      },
      onPanResponderRelease: (_, gestureState) => {
        const releaseTranslate = Math.max(0, dragStartY.current + gestureState.dy);
        const shouldClose = releaseTranslate > closeThreshold || gestureState.vy > 1.1;

        dragStartY.current = 0;

        if (shouldClose) {
          onClose();
          return;
        }

        animateSheetBack();
      },
      onPanResponderTerminate: () => {
        dragStartY.current = 0;
        animateSheetBack();
      },
    }),
  ).current;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow = (event: { endCoordinates?: { height?: number } }) => {
      setKeyboardInset(event.endCoordinates?.height ?? 0);

      const textInputState = TextInput.State as unknown as {
        currentlyFocusedInput?: () => unknown;
      };
      const focusedInput = textInputState.currentlyFocusedInput?.();
      const focusedTarget = focusedInput ? findNodeHandle(focusedInput as never) : null;

      if (focusedTarget) {
        scrollToFocusedInput(focusedTarget);
      }
    };

    const handleKeyboardHide = () => {
      setKeyboardInset(0);
    };

    const showSubscription = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSubscription = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (mode) {
      setActiveMode(mode);
      if (!mounted) {
        setMounted(true);
        translateY.setValue(hiddenSheetOffset);
        backdropOpacity.setValue(0);
        modalScale.setValue(0.98);
        requestAnimationFrame(() => {
          animateSheetToOpen();
        });
      }
      return;
    }

    if (mounted) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: hiddenSheetOffset, duration: 220, useNativeDriver: true }),
        Animated.timing(modalScale, { toValue: 0.98, duration: 180, useNativeDriver: true }),
      ]).start(() => {
        setKeyboardInset(0);
        setMounted(false);
        setActiveMode(null);
      });
    }
  }, [backdropOpacity, hiddenSheetOffset, modalScale, mode, mounted, translateY]);

  if (!mounted || !activeMode) {
    return null;
  }

  const keyboardAwareContext: BottomSheetKeyboardContextValue = {
    onInputFocus: (target) => {
      if (keyboardInset > 0) {
        scrollToFocusedInput(target);
      }
    },
  };

  const scrollContentBottomPadding = keyboardInset > 0 ? keyboardInset + 140 : 40;
  const scrollContentMinHeight =
    keyboardInset > 0 ? effectiveSheetHeight + keyboardInset + 180 : undefined;

  return (
    <Modal animationType="none" onRequestClose={onClose} statusBarTranslucent transparent visible={mounted}>
      <View style={styles.modalRoot}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.sheet,
            { height: effectiveSheetHeight, transform: [{ translateY }, { scale: modalScale }] },
          ]}
        >
          <BottomSheetKeyboardContext.Provider value={keyboardAwareContext}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
              style={styles.sheetKeyboardAvoiding}
            >
              <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
                <View style={styles.sheetTouchArea}>
                  <View {...panResponder.panHandlers} style={styles.sheetHandleTouchArea}>
                    <View style={styles.sheetHandle} />
                  </View>
                  <ScrollView
                    ref={scrollViewRef}
                    bounces={false}
                    contentContainerStyle={[
                      styles.sheetScrollContent,
                      {
                        minHeight: scrollContentMinHeight,
                        paddingBottom: scrollContentBottomPadding,
                      },
                    ]}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    {children(activeMode)}
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </BottomSheetKeyboardContext.Provider>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default function WelcomeAuthScreen() {
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [volunteerStep, setVolunteerStep] = useState(1);
  const [organizationStep, setOrganizationStep] = useState(1);
  const [volunteerForm, setVolunteerForm] = useState<VolunteerFormState>(createVolunteerFormState);
  const [organizationForm, setOrganizationForm] = useState<OrganizationFormState>(createOrganizationFormState);
  const [loginForm, setLoginForm] = useState<LoginFormState>(createLoginFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const openAuthMode = (mode: BottomSheetMode) => {
    setAuthError(null);
    if (mode === 'volunteer') setVolunteerStep(1);
    if (mode === 'organization') setOrganizationStep(1);
    setAuthMode(mode);
  };

  const closeAuthModal = () => {
    setAuthError(null);
    setAuthMode(null);
  };
  const resetVolunteerForm = () => {
    setVolunteerForm(createVolunteerFormState());
    setVolunteerStep(1);
  };
  const resetOrganizationForm = () => {
    setOrganizationForm(createOrganizationFormState());
    setOrganizationStep(1);
  };
  const resetLoginForm = () => setLoginForm(createLoginFormState());

  const validateVolunteerStepOne = () => {
    if (!volunteerForm.fullName.trim() || !volunteerForm.email.trim() || !volunteerForm.password.trim()) {
      return 'Заполните имя, электронную почту и пароль.';
    }

    if (!isValidEmail(volunteerForm.email)) {
      return 'Введите корректную электронную почту.';
    }

    if (volunteerForm.password.trim().length < 6) {
      return 'Пароль должен содержать минимум 6 символов.';
    }

    return null;
  };

  const validateVolunteerStepTwo = () => {
    if (!volunteerForm.city.trim() || !volunteerForm.bio.trim()) {
      return 'Заполните город и короткое описание.';
    }

    if (
      volunteerForm.skills.length === 0 ||
      volunteerForm.interests.length === 0 ||
      volunteerForm.causes.length === 0 ||
      volunteerForm.availability.length === 0
    ) {
      return 'Выберите хотя бы по одному варианту в навыках, интересах, направлениях и доступности.';
    }

    return null;
  };

  const validateOrganizationStepOne = () => {
    if (
      !organizationForm.organizationName.trim() ||
      !organizationForm.contactPerson.trim() ||
      !organizationForm.email.trim() ||
      !organizationForm.password.trim()
    ) {
      return 'Заполните название организации, контактное лицо, электронную почту и пароль.';
    }

    if (!isValidEmail(organizationForm.email)) {
      return 'Введите корректную электронную почту.';
    }

    if (organizationForm.password.trim().length < 6) {
      return 'Пароль должен содержать минимум 6 символов.';
    }

    return null;
  };

  const validateOrganizationStepTwo = () => {
    if (!organizationForm.location.trim() || !organizationForm.description.trim()) {
      return 'Заполните локацию и описание.';
    }

    if (!organizationForm.organizationType.trim()) {
      return 'Выберите тип организации.';
    }

    if (organizationForm.focusAreas.length === 0) {
      return 'Выберите хотя бы одно направление.';
    }

    return null;
  };

  const validateLogin = () => {
    if (!loginForm.email.trim() || !loginForm.password.trim()) {
      return 'Введите электронную почту и пароль.';
    }

    if (!isValidEmail(loginForm.email)) {
      return 'Введите корректную электронную почту.';
    }

    if (loginForm.password.trim().length < 6) {
      return 'Пароль должен содержать минимум 6 символов.';
    }

    return null;
  };

  const continueVolunteerStep = () => {
    const validationError = validateVolunteerStepOne();

    if (validationError) {
      setAuthError(validationError);
      return;
    }

    setAuthError(null);
    setVolunteerStep(2);
  };

  const continueOrganizationStep = () => {
    const validationError = validateOrganizationStepOne();

    if (validationError) {
      setAuthError(validationError);
      return;
    }

    setAuthError(null);
    setOrganizationStep(2);
  };

  const submitVolunteerSignup = async () => {
    const validationError = validateVolunteerStepTwo();

    if (validationError) {
      setAuthError(validationError);
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      await signUpVolunteer(buildVolunteerPayload(volunteerForm));
      resetVolunteerForm();
      closeAuthModal();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Не удалось создать аккаунт волонтёра.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitOrganizationSignup = async () => {
    const validationError = validateOrganizationStepTwo();

    if (validationError) {
      setAuthError(validationError);
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      await signUpOrganization(buildOrganizationPayload(organizationForm));
      resetOrganizationForm();
      closeAuthModal();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Не удалось создать аккаунт организации.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLogin = async () => {
    const validationError = validateLogin();

    if (validationError) {
      setAuthError(validationError);
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      await loginUser(loginForm.email.trim(), loginForm.password);
      // TODO: honor the "remember me" choice if session-only persistence is added later.
      // TODO: hydrate dashboard data, semantic matches, and the future RAG assistant after login.
      resetLoginForm();
      closeAuthModal();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Не удалось выполнить вход.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderSheetHeader = (title: string, subtitle: string, stepLabel?: string) => (
    <View style={styles.sheetHeader}>
      <View style={styles.headerTextWrap}>
        {stepLabel ? <Text style={styles.sheetEyebrow}>{stepLabel}</Text> : null}
        <Text style={styles.sheetTitle}>{title}</Text>
        <Text style={styles.sheetDescription}>{subtitle}</Text>
      </View>
    </View>
  );

  const renderErrorBanner = () =>
    authError ? (
      <View style={styles.errorBanner}>
        <Text style={styles.errorText}>{authError}</Text>
      </View>
    ) : null;

  const renderVolunteerSheet = () =>
    volunteerStep === 1 ? (
      <View>
        {renderSheetHeader(
          'Регистрация волонтёра',
          'Сначала создайте аккаунт, а затем заполните профиль, который позже можно будет использовать для умного подбора задач и рекомендаций.',
          'Шаг 1 из 2',
        )}
        {renderErrorBanner()}
        <AuthInput autoCapitalize="words" autoCorrect={false} editable={!isSubmitting} label="Полное имя" onChangeText={(value) => setVolunteerForm((current) => ({ ...current, fullName: value }))} placeholder="Айжан Н." value={volunteerForm.fullName} />
        <AuthInput autoCapitalize="none" autoCorrect={false} editable={!isSubmitting} keyboardType="email-address" label="Электронная почта" onChangeText={(value) => setVolunteerForm((current) => ({ ...current, email: value }))} placeholder="you@example.com" value={volunteerForm.email} />
        <AuthInput autoCapitalize="none" autoCorrect={false} editable={!isSubmitting} label="Пароль" onChangeText={(value) => setVolunteerForm((current) => ({ ...current, password: value }))} placeholder="Придумайте пароль" secureTextEntry value={volunteerForm.password} />
        <PrimaryButton disabled={isSubmitting} onPress={continueVolunteerStep} style={styles.submitButton} title="Продолжить" />
      </View>
    ) : (
      <View>
        {renderSheetHeader(
          'Профиль волонтёра',
          'Эти поля вынесены отдельно, чтобы позже их можно было использовать для эмбеддингов, семантического матчинга и AI-рекомендаций.',
          'Шаг 2 из 2',
        )}
        {renderErrorBanner()}
        <AuthInput autoCapitalize="words" autoCorrect={false} editable={!isSubmitting} label="Город" onChangeText={(value) => setVolunteerForm((current) => ({ ...current, city: value }))} placeholder="Алматы" value={volunteerForm.city} />
        <AuthInput autoCapitalize="sentences" editable={!isSubmitting} label="Коротко о себе" multiline onChangeText={(value) => setVolunteerForm((current) => ({ ...current, bio: value }))} placeholder="Расскажите о своей мотивации и сильных сторонах" value={volunteerForm.bio} />
        <ChipSelector disabled={isSubmitting} label="Навыки" onChange={(values) => setVolunteerForm((current) => ({ ...current, skills: values }))} options={VOLUNTEER_SKILLS} selectedValues={volunteerForm.skills} />
        <ChipSelector disabled={isSubmitting} label="Интересы" onChange={(values) => setVolunteerForm((current) => ({ ...current, interests: values }))} options={VOLUNTEER_INTERESTS} selectedValues={volunteerForm.interests} />
        <ChipSelector disabled={isSubmitting} label="Направления" onChange={(values) => setVolunteerForm((current) => ({ ...current, causes: values }))} options={VOLUNTEER_CAUSES} selectedValues={volunteerForm.causes} />
        <ChipSelector disabled={isSubmitting} label="Доступность" onChange={(values) => setVolunteerForm((current) => ({ ...current, availability: values }))} options={VOLUNTEER_AVAILABILITY} selectedValues={volunteerForm.availability} />
        <Pressable disabled={isSubmitting} onPress={() => { setAuthError(null); setVolunteerStep(1); }} style={({ pressed }) => [styles.backLink, pressed && !isSubmitting && styles.backLinkPressed]}>
          <Text style={styles.backLinkText}>Назад</Text>
        </Pressable>
        <PrimaryButton disabled={isSubmitting} onPress={submitVolunteerSignup} style={styles.submitButton} title={isSubmitting ? 'Создание аккаунта...' : 'Завершить регистрацию'} />
      </View>
    );

  const renderOrganizationSheet = () =>
    organizationStep === 1 ? (
      <View>
        {renderSheetHeader(
          'Регистрация организации',
          'Сначала создайте аккаунт, а затем заполните профиль организации.',
          'Шаг 1 из 2',
        )}
        {renderErrorBanner()}
        <AuthInput autoCapitalize="words" autoCorrect={false} editable={!isSubmitting} label="Название организации" onChangeText={(value) => setOrganizationForm((current) => ({ ...current, organizationName: value }))} placeholder="Фонд Доброе Будущее" value={organizationForm.organizationName} />
        <AuthInput autoCapitalize="words" autoCorrect={false} editable={!isSubmitting} label="Контактное лицо" onChangeText={(value) => setOrganizationForm((current) => ({ ...current, contactPerson: value }))} placeholder="Айгерим С." value={organizationForm.contactPerson} />
        <AuthInput autoCapitalize="none" autoCorrect={false} editable={!isSubmitting} keyboardType="email-address" label="Электронная почта" onChangeText={(value) => setOrganizationForm((current) => ({ ...current, email: value }))} placeholder="team@organization.org" value={organizationForm.email} />
        <AuthInput autoCapitalize="none" autoCorrect={false} editable={!isSubmitting} label="Пароль" onChangeText={(value) => setOrganizationForm((current) => ({ ...current, password: value }))} placeholder="Придумайте пароль" secureTextEntry value={organizationForm.password} />
        <PrimaryButton disabled={isSubmitting} onPress={continueOrganizationStep} style={styles.submitButton} title="Продолжить" />
      </View>
    ) : (
      <View>
        {renderSheetHeader(
          'Профиль организации',
          'Этот этап подготовлен для будущего AI-матчинга, поиска по профилям и более умного создания задач.',
          'Шаг 2 из 2',
        )}
        {renderErrorBanner()}
        <AuthInput autoCapitalize="words" autoCorrect={false} editable={!isSubmitting} label="Локация" onChangeText={(value) => setOrganizationForm((current) => ({ ...current, location: value }))} placeholder="Астана" value={organizationForm.location} />
        <ChipSelector disabled={isSubmitting} label="Тип организации" multiple={false} onChange={(values) => setOrganizationForm((current) => ({ ...current, organizationType: values[0] ?? '' }))} options={ORGANIZATION_TYPES} selectedValues={organizationForm.organizationType ? [organizationForm.organizationType] : []} />
        <ChipSelector disabled={isSubmitting} label="Направления" onChange={(values) => setOrganizationForm((current) => ({ ...current, focusAreas: values }))} options={ORGANIZATION_FOCUS_AREAS} selectedValues={organizationForm.focusAreas} />
        <AuthInput autoCapitalize="sentences" editable={!isSubmitting} label="Описание" multiline onChangeText={(value) => setOrganizationForm((current) => ({ ...current, description: value }))} placeholder="Расскажите, чем занимается организация и какая помощь волонтёров вам нужна" value={organizationForm.description} />
        <Pressable disabled={isSubmitting} onPress={() => { setAuthError(null); setOrganizationStep(1); }} style={({ pressed }) => [styles.backLink, pressed && !isSubmitting && styles.backLinkPressed]}>
          <Text style={styles.backLinkText}>Назад</Text>
        </Pressable>
        <PrimaryButton disabled={isSubmitting} onPress={submitOrganizationSignup} style={styles.submitButton} title={isSubmitting ? 'Создание аккаунта...' : 'Завершить регистрацию'} />
      </View>
    );

  const renderLoginSheet = () => (
    <View>
      {renderSheetHeader('Вход', 'Войдите в аккаунт, не покидая экран онбординга.')}
      {renderErrorBanner()}
      <AuthInput autoCapitalize="none" autoCorrect={false} editable={!isSubmitting} keyboardType="email-address" label="Электронная почта" onChangeText={(value) => setLoginForm((current) => ({ ...current, email: value }))} placeholder="you@example.com" value={loginForm.email} />
      <AuthInput autoCapitalize="none" autoCorrect={false} editable={!isSubmitting} label="Пароль" onChangeText={(value) => setLoginForm((current) => ({ ...current, password: value }))} placeholder="Введите пароль" secureTextEntry value={loginForm.password} />
      <Pressable disabled={isSubmitting} onPress={() => setLoginForm((current) => ({ ...current, rememberMe: !current.rememberMe }))} style={({ pressed }) => [styles.rememberRow, pressed && !isSubmitting && styles.rememberRowPressed]}>
        <View style={[styles.checkbox, loginForm.rememberMe && styles.checkboxChecked]}>
          {loginForm.rememberMe ? <View style={styles.checkboxInner} /> : null}
        </View>
        <Text style={styles.rememberText}>{'\u0417\u0430\u043f\u043e\u043c\u043d\u0438\u0442\u044c \u043c\u0435\u043d\u044f'}</Text>
      </Pressable>
      <PrimaryButton disabled={isSubmitting} onPress={submitLogin} style={styles.submitButton} title={isSubmitting ? 'Выполняется вход...' : 'Войти'} />
      <View style={styles.switchRow}>
        <Text style={styles.switchPrompt}>Нет аккаунта?</Text>
        <Pressable disabled={isSubmitting} onPress={() => openAuthMode('volunteer')}>
          <Text style={styles.switchLink}>Волонтёр</Text>
        </Pressable>
        <Text style={styles.switchPrompt}>или</Text>
        <Pressable disabled={isSubmitting} onPress={() => openAuthMode('organization')}>
          <Text style={styles.switchLink}>Организация</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderSheetContent = (mode: BottomSheetMode) => {
    switch (mode) {
      case 'volunteer':
        return renderVolunteerSheet();
      case 'organization':
        return renderOrganizationSheet();
      case 'login':
        return renderLoginSheet();
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <View pointerEvents="none" style={styles.backgroundLayer}>
        <View style={[styles.blob, styles.blobTopRight]} />
        <View style={[styles.blob, styles.blobCenterLight]} />
        <View style={[styles.blob, styles.blobBottomLeft]} />
        <View style={[styles.blob, styles.blobGlow]} />
        <View style={[styles.blob, styles.blobHighlight]} />
      </View>
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.screenContent}>
            <View style={styles.topArea}>
              <Text style={styles.brand}>Volunet</Text>
            </View>
            <View style={styles.middleArea}>
              <Image
                resizeMode="contain"
                source={require('./assets/icons/categories/welcome-image.png')}
                style={styles.welcomeImage}
              />
            </View>
            <View style={styles.bottomArea}>
              <View style={styles.actionCard}>
                <PrimaryButton onPress={() => openAuthMode('volunteer')} title="Зарегистрироваться как волонтёр" />
                <SecondaryButton onPress={() => openAuthMode('organization')} style={styles.organizationButton} title="Зарегистрироваться как организация" />
                <View style={styles.loginRow}>
                  <Text style={styles.loginPrompt}>Уже есть аккаунт?</Text>
                  <Pressable onPress={() => openAuthMode('login')}>
                    <Text style={styles.loginLink}>Войти!</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </TouchableWithoutFeedback>
      <BottomSheetModal mode={authMode} onClose={() => { if (!isSubmitting) closeAuthModal(); }}>
        {renderSheetContent}
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EEF2FF',
  },
  safeArea: {
    flex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  blob: {
    position: 'absolute',
    borderRadius: 400,
  },
  blobTopRight: {
    width: 300,
    height: 300,
    top: -72,
    right: -92,
    backgroundColor: '#5C7CFA',
    opacity: 0.34,
    transform: [{ rotate: '18deg' }],
  },
  blobCenterLight: {
    width: 440,
    height: 440,
    top: 128,
    alignSelf: 'center',
    backgroundColor: '#F8FAFF',
    opacity: 0.92,
    transform: [{ rotate: '-14deg' }],
  },
  blobBottomLeft: {
    width: 360,
    height: 360,
    bottom: -92,
    left: -130,
    backgroundColor: '#2C3FE8',
    opacity: 0.42,
    transform: [{ rotate: '16deg' }],
  },
  blobGlow: {
    width: 390,
    height: 230,
    top: 310,
    left: -36,
    backgroundColor: '#DCE5FF',
    opacity: 0.72,
    transform: [{ rotate: '22deg' }],
  },
  blobHighlight: {
    width: 170,
    height: 170,
    top: 98,
    left: 42,
    backgroundColor: '#FFFFFF',
    opacity: 0.55,
  },
  screenContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  topArea: {
    alignItems: 'center',
  },
  middleArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  bottomArea: {
    paddingBottom: 8,
  },
  brand: {
    fontFamily: TITLE_FONT_FAMILY,
    fontSize: 48,
    fontStyle: 'italic',
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#111536',
    textAlign: 'center',
    marginTop: 15
  },
  tagline: {
    maxWidth: 300,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    color: '#0C102A',
    textAlign: 'center',
  },
  welcomeImage: {
    width: '200%',
    maxWidth: 500,
    height: 280,
    marginTop: 70,
    marginBottom: 10,
    alignSelf: 'center',
    marginLeft: -30
  },
  actionCard: {
    borderWidth: 1,
    borderColor: 'rgba(92, 124, 250, 0.18)',
    borderRadius: 30,
    padding: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    shadowColor: '#2A357C',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 10,
  },
  primaryButton: {
    minHeight: 58,
    borderRadius: 22,
    backgroundColor: '#0B0F3B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 58,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(152, 186, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(92, 124, 250, 0.28)',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B2A67',
    textAlign: 'center',
  },
  organizationButton: {
    marginTop: 12,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.58,
  },
  loginRow: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  loginPrompt: {
    fontSize: 15,
    color: 'rgba(15, 22, 58, 0.72)',
    marginRight: 6,
  },
  loginLink: {
    fontSize: 15,
    fontWeight: '700',
    color: '#243BD7',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 12, 32, 0.45)',
  },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: '#FFFFFF',
    shadowColor: '#111536',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 16,
  },
  sheetKeyboardAvoiding: {
    flex: 1,
  },
  sheetTouchArea: {
    flex: 1,
  },
  sheetHandleTouchArea: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  sheetHandle: {
    width: 54,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(11, 15, 59, 0.12)',
  },
  sheetScrollContent: {
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 40,
  },
  sheetHeader: {
    marginBottom: 22,
  },
  headerTextWrap: {
    width: '100%',
  },
  sheetEyebrow: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '700',
    color: '#3041BF',
    backgroundColor: 'rgba(92, 124, 250, 0.12)',
  },
  sheetTitle: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: '#0C102A',
    marginBottom: 8,
  },
  sheetDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(15, 22, 58, 0.72)',
  },
  errorBanner: {
    marginBottom: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(202, 54, 75, 0.18)',
    backgroundColor: '#FFF1F3',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#AA2E42',
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#1A214D',
  },
  input: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(11, 15, 59, 0.08)',
    backgroundColor: '#F7F8FF',
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#141938',
  },
  multilineInput: {
    minHeight: 112,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  selectorGroup: {
    marginBottom: 14,
  },
  selectorLabel: {
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '700',
    color: '#1A214D',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    marginRight: 10,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(11, 15, 59, 0.08)',
    backgroundColor: '#F7F8FF',
  },
  chipSelected: {
    backgroundColor: '#E0E7FF',
    borderColor: 'rgba(44, 63, 232, 0.28)',
  },
  chipPressed: {
    opacity: 0.88,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#33406F',
  },
  chipTextSelected: {
    color: '#2339CA',
  },
  backLink: {
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 14,
    paddingVertical: 6,
  },
  backLinkPressed: {
    opacity: 0.72,
  },
  backLinkText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#3041BF',
  },
  submitButton: {
    marginTop: 4,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  rememberRowPressed: {
    opacity: 0.86,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(11, 15, 59, 0.14)',
    backgroundColor: '#F7F8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#0B0F3B',
    borderColor: '#0B0F3B',
  },
  checkboxInner: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  rememberText: {
    fontSize: 15,
    color: '#1B2458',
    fontWeight: '600',
  },
  switchRow: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  switchPrompt: {
    fontSize: 14,
    color: 'rgba(15, 22, 58, 0.72)',
    marginHorizontal: 4,
  },
  switchLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#243BD7',
    marginHorizontal: 4,
  },
});
