import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { storage } from '../lib/firebase';

class StorageServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'StorageServiceError';
    this.code = code;
  }
}

const getStorageErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;

const getReadableStorageError = (error: unknown) => {
  const code = getStorageErrorCode(error);

  switch (code) {
    case 'storage/unauthorized':
    case 'permission-denied':
      return 'Нет доступа к загрузке логотипа. Проверьте правила Firebase Storage.';
    case 'storage/canceled':
      return 'Загрузка изображения была отменена.';
    case 'storage/object-not-found':
      return 'Выбранное изображение не найдено.';
    case 'storage/quota-exceeded':
      return 'Превышена квота Firebase Storage.';
    case 'storage/retry-limit-exceeded':
    case 'storage/unknown':
    case 'unavailable':
      return 'Не удалось загрузить изображение. Попробуйте чуть позже.';
    case 'auth/network-request-failed':
      return 'Проблема с сетью. Проверьте интернет и попробуйте снова.';
    default:
      return 'Не удалось загрузить изображение.';
  }
};

const toStorageServiceError = (error: unknown) =>
  new StorageServiceError(getReadableStorageError(error), getStorageErrorCode(error));

const localUriToBlob = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error('Не удалось подготовить изображение к загрузке.'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });

export async function uploadOrganizationAvatar(uid: string, localUri: string): Promise<string> {
  let blob: Blob | null = null;

  try {
    const extensionMatch = localUri.match(/\.(\w+)(?:\?|$)/);
    const extension = extensionMatch?.[1]?.toLowerCase() || 'jpg';
    const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';
    const avatarRef = ref(storage, `organization-avatars/${uid}.jpg`);

    blob = await localUriToBlob(localUri);

    await uploadBytes(avatarRef, blob, { contentType });

    return await getDownloadURL(avatarRef);
  } catch (error) {
    throw toStorageServiceError(error);
  } finally {
    (blob as { close?: () => void } | null)?.close?.();
  }
}

export { StorageServiceError };
