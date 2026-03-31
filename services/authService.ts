import {
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from '../lib/firebase';
import {
  OrganizationSignupInput,
  VolunteerSignupInput,
} from '../types/auth';

class AuthServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
  }
}

const deriveHandleFromSeed = (seed: string) => {
  const normalized = seed
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/gi, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '');

  return `@${normalized || 'volunet.user'}`;
};

const getFirebaseErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;

const getReadableAuthError = (error: unknown) => {
  const code = getFirebaseErrorCode(error);

  switch (code) {
    case 'auth/email-already-in-use':
      return 'Этот email уже используется. Попробуйте войти в аккаунт.';
    case 'auth/weak-password':
      return 'Пароль должен содержать минимум 6 символов.';
    case 'auth/invalid-email':
      return 'Введите корректный email.';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Неверный email или пароль.';
    case 'auth/network-request-failed':
      return 'Ошибка сети. Проверьте интернет и попробуйте снова.';
    case 'permission-denied':
    case 'unavailable':
    case 'failed-precondition':
    case 'aborted':
      return 'Не удалось сохранить профиль в Firestore. Попробуйте ещё раз.';
    default:
      return 'Что-то пошло не так. Попробуйте ещё раз.';
  }
};

const toServiceError = (error: unknown) =>
  new AuthServiceError(getReadableAuthError(error), getFirebaseErrorCode(error));

export async function signUpVolunteer(input: VolunteerSignupInput): Promise<User> {
  let createdUser: User | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);
    const { uid } = credential.user;
    createdUser = credential.user;

    await setDoc(doc(db, 'users', uid), {
      email: input.email,
      role: 'volunteer',
      createdAt: serverTimestamp(),
      displayName: input.fullName,
      username: deriveHandleFromSeed(input.fullName || input.email.split('@')[0]),
      avatarUrl: null,
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'volunteerProfiles', uid), {
      fullName: input.fullName,
      handle: deriveHandleFromSeed(input.fullName || input.email.split('@')[0]),
      city: input.city,
      bio: input.bio,
      aiAbout: '',
      avatarUrl: null,
      skills: input.skills,
      interests: input.interests,
      causes: input.causes,
      availability: input.availability,
      embedding: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // TODO: generate volunteer embedding after profile creation.
    // TODO: add semantic matching between volunteers and organization tasks.
    // TODO: connect volunteer context to the future RAG assistant.
    return credential.user;
  } catch (error) {
    if (createdUser) {
      // TODO: add rollback strategy if Firestore document creation fails after Auth succeeds.
      // This should remove the partially created auth user and any partially written docs.
    }

    throw toServiceError(error);
  }
}

export async function signUpOrganization(input: OrganizationSignupInput): Promise<User> {
  let createdUser: User | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);
    const { uid } = credential.user;
    createdUser = credential.user;

    await setDoc(doc(db, 'users', uid), {
      email: input.email,
      role: 'organization',
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizationProfiles', uid), {
      organizationName: input.organizationName,
      contactPerson: input.contactPerson,
      location: input.location,
      organizationType: input.organizationType,
      focusAreas: input.focusAreas,
      description: input.description,
    });

    // TODO: generate task embeddings for organization-created opportunities.
    // TODO: support organization-driven task creation workflows.
    // TODO: connect organizations to the future RAG assistant.
    return credential.user;
  } catch (error) {
    if (createdUser) {
      // TODO: add rollback strategy if Firestore document creation fails after Auth succeeds.
      // This should remove the partially created auth user and any partially written docs.
    }

    throw toServiceError(error);
  }
}

export async function login(email: string, password: string): Promise<User> {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function logout(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    throw toServiceError(error);
  }
}

export function getCurrentUser() {
  return auth.currentUser;
}

export { AuthServiceError };
