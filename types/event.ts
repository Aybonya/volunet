export type EventAiAnswerMap = Record<string, string>;

export type EventCategory = 'All' | 'Design' | 'IT' | 'Environment' | 'Social';

export type EventItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  date: string;
  duration: string;
  location: string;
  imageUrl: string;
  createdBy: string;
  createdByRole: 'organization';
  isPopular: boolean;
  isRecommended: boolean;
  createdAt?: any;
  rawInput?: string;
  aiQuestionnaireAnswers?: EventAiAnswerMap;
};

export type CreateEventInput = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  date: string;
  duration: string;
  location: string;
  imageUrl: string;
  isPopular?: boolean;
  isRecommended?: boolean;
  rawInput?: string;
  aiQuestionnaireAnswers?: EventAiAnswerMap;
};

export type EventParticipationItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  organizationId: string;
  userId: string;
  status: 'joined' | 'accepted' | 'completed' | 'cancelled' | 'removed';
  hours: number;
  createdAt?: any;
  updatedAt?: any;
};

export type RegisteredVolunteerCard = {
  participationId: string;
  userId: string;
  eventId: string;
  eventTitle: string;
  status: EventParticipationItem['status'];
  createdAt?: any;
  volunteerName: string;
  volunteerHandle: string;
  volunteerAvatarUrl: string | null;
  skills: string[];
};

export type CreateEventAnnouncementInput = {
  eventId: string;
  eventTitle: string;
  title: string;
  message: string;
};

export type EventAnnouncementItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  organizationId: string;
  title: string;
  message: string;
  recipientCount: number;
  createdAt?: any;
};

export type VolunteerNotificationItem = {
  id: string;
  userId: string;
  organizationId: string;
  eventId: string;
  eventTitle: string;
  title: string;
  message: string;
  read: boolean;
  createdAt?: any;
};

export type OrganizationNotificationItem = {
  id: string;
  organizationId: string;
  eventId: string;
  eventTitle: string;
  volunteerId: string;
  volunteerName: string;
  volunteerHandle: string;
  volunteerAvatarUrl: string | null;
  read: boolean;
  createdAt?: any;
};
