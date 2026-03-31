import { EventItem } from '../types/event';
import { OrganizationProfileData } from '../types/organization';
import { VolunteerProfileData } from '../types/profile';

declare const process: {
  env: Record<string, string | undefined>;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = 'gpt-5.4-mini';

type OpenAITextResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type ParsedEventDraft = {
  title: string;
  description: string;
  category: 'Design' | 'IT' | 'Environment' | 'Social';
  tags: string[];
  date: string;
  duration: string;
  location: string;
  imagePrompt?: string;
};

class OpenAIServiceError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'OpenAIServiceError';
    this.code = code;
  }
}

const getApiKey = () => {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

  if (!apiKey) {
    throw new OpenAIServiceError('Не найден EXPO_PUBLIC_OPENAI_API_KEY. Добавьте ключ OpenAI в .env.');
  }

  return apiKey;
};

const safeJsonParse = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const extractOutputText = (payload: OpenAITextResponse) => {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks =
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
      .map((item) => item.text?.trim() ?? '')
      .filter(Boolean) ?? [];

  return chunks.join('\n').trim();
};

const mapOpenAIError = async (response: Response) => {
  let message = 'Не удалось получить ответ от OpenAI.';

  try {
    const payload = (await response.json()) as OpenAITextResponse;
    const apiMessage = payload.error?.message?.trim();

    if (apiMessage) {
      message = apiMessage;
    }
  } catch {
    // ignore JSON parsing failure and use fallback message
  }

  if (response.status === 401) {
    return new OpenAIServiceError('Ключ OpenAI недействителен или не имеет доступа.', response.status);
  }

  if (response.status === 429) {
    return new OpenAIServiceError('Слишком много AI-запросов. Попробуйте ещё раз чуть позже.', response.status);
  }

  if (response.status >= 500) {
    return new OpenAIServiceError('OpenAI временно недоступен. Попробуйте ещё раз чуть позже.', response.status);
  }

  return new OpenAIServiceError(message, response.status);
};

const createMessages = (instructions: string, userPrompt: string) => [
  {
    role: 'system',
    content: instructions,
  },
  {
    role: 'user',
    content: userPrompt,
  },
];

const callOpenAIText = async (
  instructions: string,
  userPrompt: string,
  options?: { maxOutputTokens?: number },
) => {
  // TODO: Move OpenAI calls to a secure backend before production release.
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: createMessages(instructions, userPrompt),
      max_output_tokens: options?.maxOutputTokens ?? 220,
    }),
  });

  if (!response.ok) {
    throw await mapOpenAIError(response);
  }

  const payload = (await response.json()) as OpenAITextResponse;
  const text = extractOutputText(payload);

  if (!text) {
    throw new OpenAIServiceError('OpenAI вернул пустой ответ.');
  }

  return text;
};

const callOpenAIJson = async <T>(
  instructions: string,
  userPrompt: string,
  schema: Record<string, unknown>,
) => {
  // TODO: Move OpenAI calls to a secure backend before production release.
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: createMessages(instructions, userPrompt),
      max_output_tokens: 500,
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw await mapOpenAIError(response);
  }

  const payload = (await response.json()) as OpenAITextResponse;
  const text = extractOutputText(payload);

  if (!text) {
    throw new OpenAIServiceError('OpenAI не вернул JSON-ответ.');
  }

  const parsed = safeJsonParse<T>(text);

  if (!parsed) {
    throw new OpenAIServiceError('Не удалось разобрать структурированный ответ OpenAI.');
  }

  return parsed;
};

const normalizeList = (items: string[]) => items.filter(Boolean).join(', ') || 'не указано';

const serializeVolunteerProfile = (profile: VolunteerProfileData) => ({
  fullName: profile.fullName,
  handle: profile.handle,
  city: profile.city,
  bio: profile.bio,
  aiAbout: profile.aiAbout,
  skills: profile.skills,
  interests: profile.interests,
  causes: profile.causes,
  availability: profile.availability,
});

const serializeEvent = (event: EventItem) => ({
  title: event.title,
  description: event.description,
  category: event.category,
  tags: event.tags,
  date: event.date,
  duration: event.duration,
  location: event.location,
  organizationId: event.createdBy,
  imageUrl: event.imageUrl,
  rawInput: event.rawInput ?? '',
  aiQuestionnaireAnswers: event.aiQuestionnaireAnswers ?? {},
  isPopular: event.isPopular,
  isRecommended: event.isRecommended,
});

export async function generateMatchExplanation(
  volunteerProfile: VolunteerProfileData,
  event: EventItem,
): Promise<string> {
  const instructions =
    'Ты объясняешь мэтч между профилем волонтёра и событием. Отвечай только на русском, максимум 2 коротких предложения, без воды и без процентов. Упоминай только реальные совпадения из входных данных.';

  const userPrompt = `Профиль волонтёра:\n${JSON.stringify(
    serializeVolunteerProfile(volunteerProfile),
    null,
    2,
  )}\n\nСобытие:\n${JSON.stringify(serializeEvent(event), null, 2)}\n\nОбъясни, почему событие подходит этому волонтёру.`;

  return callOpenAIText(instructions, userPrompt, { maxOutputTokens: 120 });
}

export async function answerEventQuestion(event: EventItem, question: string): Promise<string> {
  const instructions =
    'Ты отвечаешь только по данным одного события. Используй только переданный контекст события. Не придумывай ничего. Если ответа нет в данных, ответь ровно: "Организатор этого не указал." Отвечай на русском кратко и по делу.';

  const userPrompt = `Контекст события:\n${JSON.stringify(serializeEvent(event), null, 2)}\n\nВопрос пользователя:\n${question.trim()}`;

  return callOpenAIText(instructions, userPrompt, { maxOutputTokens: 180 });
}

export async function improveEventDescription(input: {
  organizationName?: string;
  tagline?: string;
  focusAreas?: string[];
  organizationType?: string;
  eventTitle?: string;
  eventDescription?: string;
}): Promise<string> {
  const instructions =
    'Ты улучшаешь описание волонтёрского события. Отвечай только готовым улучшенным текстом на русском, 1-2 коротких абзаца, без заголовков и без комментариев от себя.';

  const userPrompt = `Данные организации и события:\n${JSON.stringify(input, null, 2)}\n\nСделай описание более ясным, мотивирующим и подходящим для карточки события Volunet.`;

  return callOpenAIText(instructions, userPrompt, { maxOutputTokens: 260 });
}

export async function suggestNeededSkills(input: {
  organizationName?: string;
  focusAreas?: string[];
  organizationType?: string;
  description?: string;
  eventTitle?: string;
}): Promise<string> {
  const instructions =
    'Ты помогаешь организации понять, какие навыки и качества волонтёров стоит указать. Ответ только на русском в виде короткого списка через переносы строк. Укажи 5-8 пунктов.';

  const userPrompt = `Контекст:\n${JSON.stringify(input, null, 2)}\n\nПодскажи нужные навыки и качества волонтёров для такого профиля или события.`;

  return callOpenAIText(instructions, userPrompt, { maxOutputTokens: 220 });
}

export async function analyzeOrganizationProfile(
  profile: OrganizationProfileData,
): Promise<string> {
  const instructions =
    'Ты анализируешь профиль организации в приложении для волонтёров. Отвечай только на русском, коротко и конструктивно. Выдели слабые места профиля и дай 3-5 точных рекомендаций.';

  const userPrompt = `Профиль организации:\n${JSON.stringify(profile, null, 2)}\n\nПокажи слабые места профиля и как усилить доверие волонтёров.`;

  return callOpenAIText(instructions, userPrompt, { maxOutputTokens: 260 });
}

export async function draftOrganizationTask(profile: OrganizationProfileData): Promise<string> {
  const instructions =
    'Ты помогаешь НКО или организации сформулировать новую волонтёрскую задачу. Ответ только на русском, в формате короткого брифа: цель, кого ищем, что делать, ожидаемый результат.';

  const userPrompt = `Профиль организации:\n${JSON.stringify(profile, null, 2)}\n\nСформулируй новую волонтёрскую задачу для публикации в Volunet.`;

  return callOpenAIText(instructions, userPrompt, { maxOutputTokens: 240 });
}

export async function parseRawEventInput(rawText: string): Promise<ParsedEventDraft> {
  const instructions =
    'Преобразуй сырой текст организации в JSON для формы события. Категория должна быть одной из: Design, IT, Environment, Social. Если чего-то не хватает, оставь пустую строку. Верни JSON и только JSON.';

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      category: {
        type: 'string',
        enum: ['Design', 'IT', 'Environment', 'Social'],
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
      date: { type: 'string' },
      duration: { type: 'string' },
      location: { type: 'string' },
      imagePrompt: { type: 'string' },
    },
    required: ['title', 'description', 'category', 'tags', 'date', 'duration', 'location', 'imagePrompt'],
  };

  const parsed = await callOpenAIJson<ParsedEventDraft>(
    instructions,
    `Сырой текст организации:\n${rawText.trim()}\n\nВыдели структурированные поля для карточки события Volunet и верни JSON.`,
    schema,
  );

  return {
    title: parsed.title?.trim() ?? '',
    description: parsed.description?.trim() ?? '',
    category:
      parsed.category === 'Design' ||
      parsed.category === 'IT' ||
      parsed.category === 'Environment' ||
      parsed.category === 'Social'
        ? parsed.category
        : 'Social',
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((item) => item.trim()).filter(Boolean) : [],
    date: parsed.date?.trim() ?? '',
    duration: parsed.duration?.trim() ?? '',
    location: parsed.location?.trim() ?? '',
    imagePrompt: parsed.imagePrompt?.trim() ?? '',
  };
}

export const buildVolunteerProfileSummary = (profile: VolunteerProfileData) =>
  [
    profile.fullName,
    profile.handle,
    profile.bio,
    profile.aiAbout,
    normalizeList(profile.skills),
    normalizeList(profile.interests),
    normalizeList(profile.causes),
    normalizeList(profile.availability),
  ]
    .filter(Boolean)
    .join(' | ');
