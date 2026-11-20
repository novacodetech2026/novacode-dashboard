import { Language } from '../types';

export interface BusinessCategoryOption {
  id: string;
  groupId: CategoryGroupId;
  labelEn: string;
  labelEs: string;
  keywords: string[];
  iconName: string;
  aiFocusEn: string;
  aiFocusEs: string;
  sampleServiceEn: string;
  sampleServiceEs: string;
}

export type CategoryGroupId =
  | 'beauty_wellness'
  | 'health_fitness'
  | 'professional_services'
  | 'home_local'
  | 'education'
  | 'pet_services'
  | 'other';

export interface BusinessCategoryGroup {
  id: CategoryGroupId;
  labelEn: string;
  labelEs: string;
}

export const BUSINESS_CATEGORY_GROUPS: BusinessCategoryGroup[] = [
  { id: 'beauty_wellness', labelEn: 'Beauty & Wellness', labelEs: 'Belleza y Bienestar' },
  { id: 'health_fitness', labelEn: 'Health & Fitness', labelEs: 'Salud y Fitness' },
  { id: 'professional_services', labelEn: 'Professional Services', labelEs: 'Servicios Profesionales' },
  { id: 'home_local', labelEn: 'Home & Local Services', labelEs: 'Hogar y Servicios Locales' },
  { id: 'education', labelEn: 'Education', labelEs: 'Educación' },
  { id: 'pet_services', labelEn: 'Pet Services', labelEs: 'Servicios para Mascotas' },
  { id: 'other', labelEn: 'Other', labelEs: 'Otros' },
];

export const BUSINESS_CATEGORIES: BusinessCategoryOption[] = [
  // 1. Beauty & Wellness
  {
    id: 'spa',
    groupId: 'beauty_wellness',
    labelEn: 'Spa',
    labelEs: 'Spa',
    keywords: ['spa', 'day spa', 'relaxation', 'spa_wellness', 'hydrotherapy'],
    iconName: 'Sparkles',
    aiFocusEn: 'spa treatments, body wraps, and relaxing appointments',
    aiFocusEs: 'tratamientos de spa, relajación y sesiones terapéuticas',
    sampleServiceEn: 'signature spa treatment',
    sampleServiceEs: 'tratamiento de spa',
  },
  {
    id: 'massage_therapy',
    groupId: 'beauty_wellness',
    labelEn: 'Massage Therapy',
    labelEs: 'Terapia de Masajes',
    keywords: ['massage', 'masaje', 'deep tissue', 'bodywork', 'therapeutic'],
    iconName: 'HeartHandshake',
    aiFocusEn: 'therapeutic massage sessions and recovery care',
    aiFocusEs: 'sesiones de masaje terapéutico y recuperación muscular',
    sampleServiceEn: 'therapeutic massage session',
    sampleServiceEs: 'sesión de masaje terapéutico',
  },
  {
    id: 'beauty_salon',
    groupId: 'beauty_wellness',
    labelEn: 'Beauty Salon',
    labelEs: 'Salón de Belleza',
    keywords: ['beauty', 'salon', 'belleza', 'styling', 'glam'],
    iconName: 'Flower2',
    aiFocusEn: 'beauty treatments, styling, and salon visits',
    aiFocusEs: 'tratamientos de belleza, estilismo y citas en salón',
    sampleServiceEn: 'beauty styling session',
    sampleServiceEs: 'sesión de belleza',
  },
  {
    id: 'barbershop',
    groupId: 'beauty_wellness',
    labelEn: 'Barbershop',
    labelEs: 'Barbería',
    keywords: ['barber', 'barberia', 'haircut', 'fade', 'beard', 'grooming'],
    iconName: 'Scissors',
    aiFocusEn: 'haircuts, fades, beard grooming, and hot towel shaves',
    aiFocusEs: 'cortes de cabello, fades, perfilado de barba y afeitado',
    sampleServiceEn: 'haircut and beard trim',
    sampleServiceEs: 'corte y perfilado de barba',
  },
  {
    id: 'nail_salon',
    groupId: 'beauty_wellness',
    labelEn: 'Nail Salon',
    labelEs: 'Salón de Uñas',
    keywords: ['nails', 'manicure', 'pedicure', 'uñas', 'acrylic', 'gel'],
    iconName: 'Palette',
    aiFocusEn: 'manicures, pedicures, and nail artistry appointments',
    aiFocusEs: 'manicura, pedicura y diseño de uñas',
    sampleServiceEn: 'gel manicure appointment',
    sampleServiceEs: 'cita de manicura en gel',
  },
  {
    id: 'hair_salon',
    groupId: 'beauty_wellness',
    labelEn: 'Hair Salon',
    labelEs: 'Peluquería',
    keywords: ['hair', 'balayage', 'color', 'blowout', 'peluqueria', 'cabello'],
    iconName: 'Scissors',
    aiFocusEn: 'hair styling, color, cuts, and treatments',
    aiFocusEs: 'corte, coloración, balayage y tratamientos capilares',
    sampleServiceEn: 'hair styling & color consultation',
    sampleServiceEs: 'cita de corte o coloración',
  },
  {
    id: 'esthetician',
    groupId: 'beauty_wellness',
    labelEn: 'Esthetician',
    labelEs: 'Cosmetología y Estética',
    keywords: ['facial', 'skincare', 'esthetician', 'waxing', 'brows', 'lashes'],
    iconName: 'Sparkles',
    aiFocusEn: 'facials, skincare protocols, and aesthetic treatments',
    aiFocusEs: 'faciales, cuidado de la piel y estética personalizada',
    sampleServiceEn: 'custom facial treatment',
    sampleServiceEs: 'tratamiento facial personalizado',
  },
  {
    id: 'medspa',
    groupId: 'beauty_wellness',
    labelEn: 'MedSpa',
    labelEs: 'MedSpa / Estética Médica',
    keywords: ['medspa', 'medical_aesthetic', 'botox', 'laser', 'dermatology', 'filler'],
    iconName: 'Stethoscope',
    aiFocusEn: 'clinical aesthetic procedures, laser care, and skin consultations',
    aiFocusEs: 'procedimientos médico-estéticos, láser y valoraciones faciales',
    sampleServiceEn: 'aesthetic consultation',
    sampleServiceEs: 'valoración médico-estética',
  },
  {
    id: 'wellness_center',
    groupId: 'beauty_wellness',
    labelEn: 'Wellness Center',
    labelEs: 'Centro de Bienestar',
    keywords: ['wellness', 'holistic', 'sauna', 'cryo', 'recovery'],
    iconName: 'Leaf',
    aiFocusEn: 'holistic wellness therapies and restorative sessions',
    aiFocusEs: 'terapias holísticas y sesiones integrales de bienestar',
    sampleServiceEn: 'wellness consultation',
    sampleServiceEs: 'sesión de bienestar',
  },
  {
    id: 'makeup_artist',
    groupId: 'beauty_wellness',
    labelEn: 'Makeup Artist',
    labelEs: 'Maquillaje Profesional',
    keywords: ['makeup', 'bridal', 'maquillaje', 'mua'],
    iconName: 'Palette',
    aiFocusEn: 'event makeup, bridal trials, and on-location glam',
    aiFocusEs: 'maquillaje social, novias y sesiones a domicilio',
    sampleServiceEn: 'event makeup session',
    sampleServiceEs: 'sesión de maquillaje profesional',
  },
  {
    id: 'tattoo_studio',
    groupId: 'beauty_wellness',
    labelEn: 'Tattoo Studio',
    labelEs: 'Estudio de Tatuajes',
    keywords: ['tattoo', 'ink', 'piercing', 'tatuajes'],
    iconName: 'PenTool',
    aiFocusEn: 'tattoo design consultations and studio sessions',
    aiFocusEs: 'consultas de diseño y sesiones de tatuaje',
    sampleServiceEn: 'tattoo consultation',
    sampleServiceEs: 'consulta de tatuaje',
  },

  // 2. Health & Fitness
  {
    id: 'personal_trainer',
    groupId: 'health_fitness',
    labelEn: 'Personal Trainer',
    labelEs: 'Entrenador Personal',
    keywords: ['trainer', 'coach', 'workout', 'fitness', 'entrenador'],
    iconName: 'Dumbbell',
    aiFocusEn: '1-on-1 training sessions and fitness assessments',
    aiFocusEs: 'sesiones de entrenamiento personalizado y evaluaciones físicas',
    sampleServiceEn: 'personal training session',
    sampleServiceEs: 'sesión de entrenamiento',
  },
  {
    id: 'fitness_studio',
    groupId: 'health_fitness',
    labelEn: 'Fitness Studio',
    labelEs: 'Estudio Fitness',
    keywords: ['gym', 'studio', 'bootcamp', 'hiit', 'gimnasio'],
    iconName: 'Dumbbell',
    aiFocusEn: 'studio classes, coaching, and fitness bookings',
    aiFocusEs: 'clases dirigidas y reservas de entrenamiento',
    sampleServiceEn: 'studio fitness session',
    sampleServiceEs: 'clase o sesión fitness',
  },
  {
    id: 'yoga_studio',
    groupId: 'health_fitness',
    labelEn: 'Yoga Studio',
    labelEs: 'Estudio de Yoga',
    keywords: ['yoga', 'mindfulness', 'meditation', 'vinyasa'],
    iconName: 'Activity',
    aiFocusEn: 'yoga classes, private sessions, and mindfulness workshops',
    aiFocusEs: 'clases de yoga, sesiones privadas y bienestar integral',
    sampleServiceEn: 'private yoga class',
    sampleServiceEs: 'clase de yoga',
  },
  {
    id: 'pilates_studio',
    groupId: 'health_fitness',
    labelEn: 'Pilates Studio',
    labelEs: 'Estudio de Pilates',
    keywords: ['pilates', 'reformer', 'core', 'posture'],
    iconName: 'Activity',
    aiFocusEn: 'reformer pilates sessions and small-group classes',
    aiFocusEs: 'sesiones de pilates reformer y clases guiadas',
    sampleServiceEn: 'reformer pilates session',
    sampleServiceEs: 'sesión de pilates',
  },
  {
    id: 'physical_therapy',
    groupId: 'health_fitness',
    labelEn: 'Physical Therapy',
    labelEs: 'Fisioterapia',
    keywords: ['physio', 'rehab', 'physical therapy', 'fisioterapia', 'kinesiologia'],
    iconName: 'HeartPulse',
    aiFocusEn: 'physical rehabilitation, mobility evaluations, and therapy',
    aiFocusEs: 'rehabilitación física, terapia de movilidad y valoraciones',
    sampleServiceEn: 'physical therapy evaluation',
    sampleServiceEs: 'sesión de fisioterapia',
  },
  {
    id: 'chiropractic_clinic',
    groupId: 'health_fitness',
    labelEn: 'Chiropractic Clinic',
    labelEs: 'Clínica Quiropráctica',
    keywords: ['chiropractor', 'spine', 'adjustment', 'quiropractico'],
    iconName: 'HeartPulse',
    aiFocusEn: 'spinal adjustments and chiropractic care visits',
    aiFocusEs: 'ajustes quiroprácticos y consultas de columna',
    sampleServiceEn: 'chiropractic adjustment',
    sampleServiceEs: 'ajuste quiropráctico',
  },
  {
    id: 'dental_clinic',
    groupId: 'health_fitness',
    labelEn: 'Dental Clinic',
    labelEs: 'Clínica Dental',
    keywords: ['dental', 'dentist', 'odontologia', 'teeth', 'orthodontics'],
    iconName: 'Stethoscope',
    aiFocusEn: 'dental cleanings, checkups, and orthodontic consultations',
    aiFocusEs: 'limpiezas dentales, revisiones y consultas odontológicas',
    sampleServiceEn: 'dental checkup & cleaning',
    sampleServiceEs: 'revisión y limpieza dental',
  },
  {
    id: 'medical_practice',
    groupId: 'health_fitness',
    labelEn: 'Medical Practice',
    labelEs: 'Consultorio Médico',
    keywords: ['clinic', 'doctor', 'medical', 'health', 'consultorio'],
    iconName: 'Stethoscope',
    aiFocusEn: 'patient consultations, follow-ups, and clinical appointments',
    aiFocusEs: 'consultas médicas, seguimientos y citas clínicas',
    sampleServiceEn: 'medical consultation',
    sampleServiceEs: 'consulta médica',
  },
  {
    id: 'nutrition_consulting',
    groupId: 'health_fitness',
    labelEn: 'Nutrition Consulting',
    labelEs: 'Consultoría de Nutrición',
    keywords: ['nutrition', 'dietitian', 'nutriologo', 'diet', 'meal plan'],
    iconName: 'Apple',
    aiFocusEn: 'nutrition assessments and personalized meal plan follow-ups',
    aiFocusEs: 'valoraciones nutricionales y planes alimenticios',
    sampleServiceEn: 'nutrition consultation',
    sampleServiceEs: 'consulta de nutrición',
  },

  // 3. Professional Services
  {
    id: 'consulting',
    groupId: 'professional_services',
    labelEn: 'Consulting',
    labelEs: 'Consultoría',
    keywords: ['consulting', 'advisory', 'strategy', 'consultoria'],
    iconName: 'Briefcase',
    aiFocusEn: 'discovery calls, strategy sessions, and client consultations',
    aiFocusEs: 'sesiones estratégicas, asesorías y llamadas de descubrimiento',
    sampleServiceEn: 'strategy consultation',
    sampleServiceEs: 'sesión de consultoría',
  },
  {
    id: 'accounting',
    groupId: 'professional_services',
    labelEn: 'Accounting',
    labelEs: 'Contabilidad e Impuestos',
    keywords: ['accounting', 'cpa', 'tax', 'bookkeeping', 'contabilidad'],
    iconName: 'Calculator',
    aiFocusEn: 'tax reviews, bookkeeping consultations, and compliance calls',
    aiFocusEs: 'revisiones fiscales, asesoría contable y declaraciones',
    sampleServiceEn: 'tax & accounting review',
    sampleServiceEs: 'asesoría contable',
  },
  {
    id: 'legal_services',
    groupId: 'professional_services',
    labelEn: 'Legal Services',
    labelEs: 'Servicios Legales',
    keywords: ['legal', 'law', 'attorney', 'lawyer', 'abogado', 'notary'],
    iconName: 'Scale',
    aiFocusEn: 'initial legal consultations and case review appointments',
    aiFocusEs: 'consultas jurídicas y revisión de expedientes',
    sampleServiceEn: 'legal consultation',
    sampleServiceEs: 'consulta legal',
  },
  {
    id: 'financial_advisory',
    groupId: 'professional_services',
    labelEn: 'Financial Advisory',
    labelEs: 'Asesoría Financiera',
    keywords: ['finance', 'wealth', 'investment', 'financiera'],
    iconName: 'TrendingUp',
    aiFocusEn: 'wealth planning reviews and financial strategy meetings',
    aiFocusEs: 'planificación patrimonial y asesoría financiera',
    sampleServiceEn: 'financial planning review',
    sampleServiceEs: 'revisión financiera',
  },
  {
    id: 'insurance_agency',
    groupId: 'professional_services',
    labelEn: 'Insurance Agency',
    labelEs: 'Agencia de Seguros',
    keywords: ['insurance', 'policy', 'seguros', 'coverage'],
    iconName: 'Shield',
    aiFocusEn: 'policy reviews, quotes, and coverage consultations',
    aiFocusEs: 'cotizaciones, revisión de pólizas y asesoría en seguros',
    sampleServiceEn: 'policy consultation',
    sampleServiceEs: 'asesoría de pólizas',
  },
  {
    id: 'marketing_agency',
    groupId: 'professional_services',
    labelEn: 'Marketing Agency',
    labelEs: 'Agencia de Marketing',
    keywords: ['marketing', 'agency', 'seo', 'ads', 'branding', 'social media'],
    iconName: 'Megaphone',
    aiFocusEn: 'campaign audits, discovery calls, and creative briefings',
    aiFocusEs: 'auditorías de campaña, briefings y llamadas de estrategia',
    sampleServiceEn: 'marketing discovery call',
    sampleServiceEs: 'sesión de estrategia digital',
  },
  {
    id: 'photography',
    groupId: 'professional_services',
    labelEn: 'Photography',
    labelEs: 'Fotografía y Video',
    keywords: ['photo', 'photography', 'studio', 'portrait', 'fotografia'],
    iconName: 'Camera',
    aiFocusEn: 'photo shoots, portrait sessions, and event bookings',
    aiFocusEs: 'sesiones fotográficas, retratos y cobertura de eventos',
    sampleServiceEn: 'photography session',
    sampleServiceEs: 'sesión fotográfica',
  },
  {
    id: 'business_coaching',
    groupId: 'professional_services',
    labelEn: 'Business Coaching',
    labelEs: 'Coaching Empresarial',
    keywords: ['coaching', 'executive', 'mentor', 'leadership'],
    iconName: 'Compass',
    aiFocusEn: 'executive coaching sessions and leadership check-ins',
    aiFocusEs: 'sesiones de coaching ejecutivo y mentoría empresarial',
    sampleServiceEn: 'executive coaching session',
    sampleServiceEs: 'sesión de coaching',
  },

  // 4. Home & Local Services
  {
    id: 'cleaning_services',
    groupId: 'home_local',
    labelEn: 'Cleaning Services',
    labelEs: 'Servicios de Limpieza',
    keywords: ['cleaning', 'maid', 'janitorial', 'limpieza', 'deep clean'],
    iconName: 'Home',
    aiFocusEn: 'residential or commercial cleaning visits and estimates',
    aiFocusEs: 'visitas de limpieza residencial o comercial y presupuestos',
    sampleServiceEn: 'deep cleaning visit',
    sampleServiceEs: 'servicio de limpieza',
  },
  {
    id: 'plumbing',
    groupId: 'home_local',
    labelEn: 'Plumbing',
    labelEs: 'Plomería / Fontanería',
    keywords: ['plumbing', 'plumber', 'pipes', 'leak', 'plomeria', 'fontaneria'],
    iconName: 'Wrench',
    aiFocusEn: 'plumbing inspections, repairs, and emergency dispatches',
    aiFocusEs: 'inspecciones de plomería, reparaciones y visitas técnicas',
    sampleServiceEn: 'plumbing service visit',
    sampleServiceEs: 'visita técnica de plomería',
  },
  {
    id: 'electrical_services',
    groupId: 'home_local',
    labelEn: 'Electrical Services',
    labelEs: 'Servicios Eléctricos',
    keywords: ['electrical', 'electrician', 'wiring', 'electricidad'],
    iconName: 'Zap',
    aiFocusEn: 'electrical diagnostics, installations, and safety checks',
    aiFocusEs: 'diagnósticos eléctricos, instalaciones y mantenimiento',
    sampleServiceEn: 'electrical inspection',
    sampleServiceEs: 'revisión eléctrica',
  },
  {
    id: 'hvac',
    groupId: 'home_local',
    labelEn: 'HVAC',
    labelEs: 'Climatización (HVAC)',
    keywords: ['hvac', 'ac', 'heating', 'cooling', 'aire acondicionado'],
    iconName: 'Wind',
    aiFocusEn: 'heating & cooling maintenance, tune-ups, and repairs',
    aiFocusEs: 'mantenimiento de aire acondicionado, calefacción y reparaciones',
    sampleServiceEn: 'HVAC tune-up & diagnostic',
    sampleServiceEs: 'mantenimiento de climatización',
  },
  {
    id: 'landscaping',
    groupId: 'home_local',
    labelEn: 'Landscaping',
    labelEs: 'Jardinería y Paisajismo',
    keywords: ['landscaping', 'lawn', 'garden', 'jardineria', 'paisajismo'],
    iconName: 'Trees',
    aiFocusEn: 'lawn maintenance, landscaping quotes, and garden care',
    aiFocusEs: 'mantenimiento de jardines, diseño exterior y cotizaciones',
    sampleServiceEn: 'landscaping estimate',
    sampleServiceEs: 'visita de jardinería',
  },
  {
    id: 'home_maintenance',
    groupId: 'home_local',
    labelEn: 'Home Maintenance',
    labelEs: 'Mantenimiento del Hogar',
    keywords: ['handyman', 'maintenance', 'repair', 'remodel', 'hogar'],
    iconName: 'Hammer',
    aiFocusEn: 'handyman repairs, installations, and property upkeep',
    aiFocusEs: 'reparaciones generales, instalaciones y mantenimiento',
    sampleServiceEn: 'home maintenance visit',
    sampleServiceEs: 'visita de mantenimiento',
  },
  {
    id: 'pest_control',
    groupId: 'home_local',
    labelEn: 'Pest Control',
    labelEs: 'Control de Plagas',
    keywords: ['pest', 'fumigation', 'exterminator', 'plagas', 'fumigacion'],
    iconName: 'Bug',
    aiFocusEn: 'property inspections and scheduled pest treatments',
    aiFocusEs: 'inspecciones preventivas y fumigación programada',
    sampleServiceEn: 'pest inspection & treatment',
    sampleServiceEs: 'servicio de control de plagas',
  },
  {
    id: 'moving_services',
    groupId: 'home_local',
    labelEn: 'Moving Services',
    labelEs: 'Mudanzas y Logística',
    keywords: ['moving', 'movers', 'relocation', 'mudanzas'],
    iconName: 'Truck',
    aiFocusEn: 'moving surveys, packing schedules, and relocation dates',
    aiFocusEs: 'evaluaciones de mudanza, embalaje y traslados',
    sampleServiceEn: 'moving estimate & scheduling',
    sampleServiceEs: 'cotización de mudanza',
  },
  {
    id: 'auto_detailing',
    groupId: 'home_local',
    labelEn: 'Auto Detailing',
    labelEs: 'Detailing Automotriz',
    keywords: ['detailing', 'car wash', 'ceramic', 'tint', 'auto'],
    iconName: 'Car',
    aiFocusEn: 'interior/exterior detailing, ceramic coating, and mobile washes',
    aiFocusEs: 'lavado detallado, recubrimiento cerámico y atención móvil',
    sampleServiceEn: 'full auto detailing',
    sampleServiceEs: 'servicio de detailing automotriz',
  },

  // 5. Education
  {
    id: 'tutoring',
    groupId: 'education',
    labelEn: 'Tutoring',
    labelEs: 'Tutorías Académicas',
    keywords: ['tutor', 'math', 'science', 'test prep', 'clases'],
    iconName: 'GraduationCap',
    aiFocusEn: '1-on-1 tutoring sessions and academic prep',
    aiFocusEs: 'clases particulares, regularización y preparación de exámenes',
    sampleServiceEn: 'tutoring session',
    sampleServiceEs: 'sesión de tutoría',
  },
  {
    id: 'language_lessons',
    groupId: 'education',
    labelEn: 'Language Lessons',
    labelEs: 'Clases de Idiomas',
    keywords: ['language', 'english', 'spanish', 'idiomas', 'esl'],
    iconName: 'Languages',
    aiFocusEn: 'language proficiency assessments and conversational lessons',
    aiFocusEs: 'evaluaciones de nivel y clases de conversación',
    sampleServiceEn: 'language lesson',
    sampleServiceEs: 'clase de idioma',
  },
  {
    id: 'music_lessons',
    groupId: 'education',
    labelEn: 'Music Lessons',
    labelEs: 'Clases de Música',
    keywords: ['music', 'piano', 'guitar', 'vocal', 'musica'],
    iconName: 'Music',
    aiFocusEn: 'instrument lessons, vocal coaching, and studio practice',
    aiFocusEs: 'clases de instrumento, canto y práctica guiada',
    sampleServiceEn: 'music lesson',
    sampleServiceEs: 'clase de música',
  },
  {
    id: 'driving_school',
    groupId: 'education',
    labelEn: 'Driving School',
    labelEs: 'Escuela de Manejo',
    keywords: ['driving', 'manejo', 'conduccion', 'license'],
    iconName: 'Car',
    aiFocusEn: 'behind-the-wheel lessons and road test prep',
    aiFocusEs: 'clases prácticas de conducción y preparación de licencia',
    sampleServiceEn: 'driving lesson',
    sampleServiceEs: 'clase práctica de manejo',
  },
  {
    id: 'training_center',
    groupId: 'education',
    labelEn: 'Training Center',
    labelEs: 'Centro de Capacitación',
    keywords: ['training', 'workshop', 'certification', 'capacitacion'],
    iconName: 'BookOpen',
    aiFocusEn: 'certification workshops and instructor-led trainings',
    aiFocusEs: 'talleres de certificación y cursos de capacitación',
    sampleServiceEn: 'training workshop',
    sampleServiceEs: 'sesión de capacitación',
  },

  // 6. Pet Services
  {
    id: 'pet_grooming',
    groupId: 'pet_services',
    labelEn: 'Pet Grooming',
    labelEs: 'Estética Canina y Mascotas',
    keywords: ['pet', 'grooming', 'dog', 'cat', 'peluqueria canina', 'mascotas'],
    iconName: 'PawPrint',
    aiFocusEn: 'pet bathing, grooming, and mobile pet spa appointments',
    aiFocusEs: 'baño, corte y estética para mascotas en tienda o a domicilio',
    sampleServiceEn: 'full pet grooming session',
    sampleServiceEs: 'sesión de baño y estética',
  },
  {
    id: 'dog_training',
    groupId: 'pet_services',
    labelEn: 'Dog Training',
    labelEs: 'Adiestramiento Canino',
    keywords: ['dog training', 'obedience', 'puppy', 'adiestramiento'],
    iconName: 'PawPrint',
    aiFocusEn: 'obedience evaluations and private behavior sessions',
    aiFocusEs: 'evaluaciones de conducta y adiestramiento canino',
    sampleServiceEn: 'dog training session',
    sampleServiceEs: 'sesión de adiestramiento',
  },
  {
    id: 'pet_sitting',
    groupId: 'pet_services',
    labelEn: 'Pet Sitting',
    labelEs: 'Cuidado y Paseo de Mascotas',
    keywords: ['pet sitting', 'boarding', 'walker', 'guarderia'],
    iconName: 'PawPrint',
    aiFocusEn: 'pet sitting visits, walks, and boarding reservations',
    aiFocusEs: 'cuidado a domicilio, paseos y reservaciones de hospedaje',
    sampleServiceEn: 'pet sitting visit',
    sampleServiceEs: 'visita de cuidado',
  },
  {
    id: 'veterinary_services',
    groupId: 'pet_services',
    labelEn: 'Veterinary Services',
    labelEs: 'Servicios Veterinarios',
    keywords: ['vet', 'veterinary', 'veterinaria', 'vaccine', 'pet clinic'],
    iconName: 'Stethoscope',
    aiFocusEn: 'veterinary checkups, vaccinations, and wellness visits',
    aiFocusEs: 'consultas veterinarias, vacunación y revisiones médicas',
    sampleServiceEn: 'veterinary checkup',
    sampleServiceEs: 'consulta veterinaria',
  },

  // 7. Other
  {
    id: 'event_services',
    groupId: 'other',
    labelEn: 'Event Services',
    labelEs: 'Eventos y Planificación',
    keywords: ['event', 'wedding', 'planner', 'catering', 'eventos'],
    iconName: 'CalendarHeart',
    aiFocusEn: 'event planning consultations and venue walkthroughs',
    aiFocusEs: 'asesorías de eventos, coordinación y citas de cotización',
    sampleServiceEn: 'event planning consultation',
    sampleServiceEs: 'consulta de planificación',
  },
  {
    id: 'real_estate',
    groupId: 'other',
    labelEn: 'Real Estate',
    labelEs: 'Bienes Raíces',
    keywords: ['real estate', 'property', 'showing', 'inmobiliaria'],
    iconName: 'Building2',
    aiFocusEn: 'property showings, buyer consultations, and appraisals',
    aiFocusEs: 'visitas a propiedades, asesoría inmobiliaria y citas',
    sampleServiceEn: 'property showing',
    sampleServiceEs: 'recorrido de propiedad',
  },
  {
    id: 'automotive_services',
    groupId: 'other',
    labelEn: 'Automotive Services',
    labelEs: 'Servicios Automotrices',
    keywords: ['auto', 'mechanic', 'repair', 'tires', 'taller'],
    iconName: 'Wrench',
    aiFocusEn: 'vehicle diagnostics, maintenance, and repair bay bookings',
    aiFocusEs: 'diagnóstico vehicular, mantenimiento y citas en taller',
    sampleServiceEn: 'vehicle inspection & service',
    sampleServiceEs: 'revisión automotriz',
  },
  {
    id: 'custom_business',
    groupId: 'other',
    labelEn: 'Custom Business',
    labelEs: 'Negocio Personalizado',
    keywords: ['custom', 'other', 'otro', 'personalizado', 'general'],
    iconName: 'Briefcase',
    aiFocusEn: 'client appointments, consultations, and tailored services',
    aiFocusEs: 'citas de clientes, consultas y servicios personalizados',
    sampleServiceEn: 'scheduled appointment',
    sampleServiceEs: 'cita programada',
  },
];

// Map legacy DB category IDs seamlessly to the expanded taxonomy
const LEGACY_CATEGORY_MAP: Record<string, string> = {
  spa_wellness: 'spa',
  medical_aesthetic: 'medspa',
  other: 'custom_business',
  general: 'custom_business',
};

export function normalizeCategoryId(rawCategory?: string | null): string {
  if (!rawCategory) return 'custom_business';
  const trimmed = rawCategory.trim();
  if (trimmed.startsWith('custom:')) return 'custom_business';
  const lower = trimmed.toLowerCase();
  if (LEGACY_CATEGORY_MAP[lower]) return LEGACY_CATEGORY_MAP[lower];
  const exact = BUSINESS_CATEGORIES.find(c => c.id === lower);
  if (exact) return exact.id;
  return 'custom_business';
}

export function getCategoryOption(rawCategory?: string | null): BusinessCategoryOption {
  const normalizedId = normalizeCategoryId(rawCategory);
  return (
    BUSINESS_CATEGORIES.find(c => c.id === normalizedId) ||
    BUSINESS_CATEGORIES[BUSINESS_CATEGORIES.length - 1]
  );
}

export function getCategoryDisplayLabel(
  rawCategory: string | undefined,
  lang: Language,
  fallbackEn?: string,
  fallbackEs?: string,
  customName?: string
): string {
  if (customName?.trim()) return customName.trim();
  if (rawCategory?.startsWith('custom:')) {
    const customLabel = rawCategory.slice('custom:'.length).trim();
    if (customLabel) return customLabel;
  }

  const normalizedId = normalizeCategoryId(rawCategory);
  const option = BUSINESS_CATEGORIES.find(c => c.id === normalizedId);

  if (option && (normalizedId !== 'custom_business' || !fallbackEn)) {
    return lang === 'es' ? option.labelEs : option.labelEn;
  }

  if (lang === 'es' && fallbackEs) return fallbackEs;
  if (lang === 'en' && fallbackEn) return fallbackEn;
  return option ? (lang === 'es' ? option.labelEs : option.labelEn) : 'Business';
}
