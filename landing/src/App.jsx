import { useState, useEffect, useRef } from "react";

// ── MODULE ICONS (SVG) ────────────────────────────────────────────
const ModuleIcons = {
  Planning: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/>
      <line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  ),
  Scheduling: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="7" y1="4" x2="7" y2="2"/>
      <line x1="17" y1="4" x2="17" y2="2"/>
      <rect x="7" y="13" width="3" height="2" rx="0.5" fill={color} stroke="none"/>
      <rect x="11" y="13" width="5" height="2" rx="0.5" fill={color} stroke="none" opacity="0.6"/>
    </svg>
  ),
  Rostering: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
      <line x1="15" y1="3" x2="15" y2="21"/>
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" fill={color} stroke="none" opacity="0.35"/>
    </svg>
  ),
  Incidencias: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <circle cx="12" cy="17" r="1" fill={color} stroke="none"/>
    </svg>
  ),
  Inventario: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  Analytics: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
      <line x1="3"  y1="20" x2="21" y2="20"/>
      <polyline points="3 10 7 6 11 9 15 4 21 7" stroke={color} strokeWidth="1.4" strokeDasharray="0"/>
      <circle cx="21" cy="7" r="1.5" fill={color} stroke="none"/>
    </svg>
  ),
  // Use case icons
  Waste: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  ),
  Cleaning: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18"/>
      <path d="M5 21V7l8-4v18"/>
      <path d="M19 21V11l-6-4"/>
      <path d="M9 9h1M9 12h1M9 15h1M9 18h1"/>
    </svg>
  ),
  Maintenance: ({ color }) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  ),
  // Value icons
  Target: ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="6"/>
      <circle cx="12" cy="12" r="2" fill={color} stroke="none"/>
    </svg>
  ),
  Speed: ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
  Security: ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
  ),
  Leaf: ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
    </svg>
  ),
  // Hero section icons
  HowItWorks1: ({ color }) => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
    </svg>
  ),
  HowItWorks2: ({ color }) => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  HowItWorks3: ({ color }) => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18"/>
      <path d="m19 9-5 5-4-4-3 3"/>
    </svg>
  ),
};

// ── APP URL ────────────────────────────────────────────────────────
const APP_URL = "https://app.operantia.com"; // update when live

// ── TRANSLATIONS ──────────────────────────────────────────────────
const T = {
  es: {
    nav: {
      product: "Producto",
      modules: "Módulos",
      pricing: "Precios",
      about: "Empresa",
      login: "Acceder",
      demo: "Solicitar demo",
    },
    hero: {
      tag: "Plataforma de operaciones",
      h1a: "Gestión inteligente",
      h1b: "de flotas urbanas",
      sub: "Planifica rutas, optimiza horarios, gestiona turnos y controla incidencias — todo en una plataforma integrada y en tiempo real.",
      cta1: "Solicitar demo",
      cta2: "Ver en acción",
      badge1: "Planificación VRP",
      badge2: "Tiempo real",
      badge3: "Multi-empresa",
    },
    stats: [
      { value: "5", label: "Módulos integrados" },
      { value: "VRP", label: "Optimización de rutas" },
      { value: "Real-time", label: "Datos en vivo" },
      { value: "100%", label: "En la nube" },
    ],
    modules: {
      tag: "Módulos",
      h2: "Todo lo que necesitas, en un solo lugar",
      sub: "Cada módulo está diseñado para cubrir una fase crítica de la operación de flotas urbanas.",
      items: [
        {
          icon: "Planning",
          name: "Planning",
          desc: "Importa archivos KML de tu flota, define zonas geográficas, asigna colores por barrio y visualiza tus rutas en mapa interactivo.",
          pills: ["KML import", "Mapa interactivo", "Zonas y barrios"],
          color: "#4f8ef7",
        },
        {
          icon: "Scheduling",
          name: "Scheduling",
          desc: "Optimiza la asignación de conductores con algoritmo VRP (Vehicle Routing Problem). Genera Gantt automático multi-día con restricciones de jornada.",
          pills: ["VRP Algorithm", "Gantt Chart", "Multi-día"],
          color: "#a78bfa",
        },
        {
          icon: "Rostering",
          name: "Rostering",
          desc: "Gestiona el cuadrante de disponibilidad de tus trabajadores. Asigna turnos M/T/N y detecta conflictos automáticamente con el scheduling.",
          pills: ["Cuadrante mensual", "Detección conflictos", "Bulk assign"],
          color: "#34d399",
        },
        {
          icon: "Incidencias",
          name: "Incidencias",
          desc: "Registra, categoriza y haz seguimiento de incidencias operativas. Estadísticas, comentarios y flujo de estados para el equipo de administración.",
          pills: ["Categorías", "Prioridades", "Panel estadístico"],
          color: "#fb923c",
        },
        {
          icon: "Inventario",
          name: "Inventario",
          desc: "Controla el stock de recambios y materiales. Alertas de stock bajo, registro de movimientos y trazabilidad completa por producto.",
          pills: ["Control stock", "Alertas mínimos", "Movimientos"],
          color: "#fbbf24",
        },
        {
          icon: "Analytics",
          name: "Analytics",
          desc: "Visualiza KPIs operativos en tiempo real: productividad por conductor, cumplimiento de rutas, evolución de incidencias y tendencias de consumo.",
          pills: ["KPIs en vivo", "Tendencias", "Exportar CSV"],
          color: "#22d3ee",
        },
      ],
    },
    howitworks: {
      tag: "Cómo funciona",
      h2: "De la planificación a la ejecución",
      sub: "Tres pasos para transformar la gestión de tu flota.",
      steps: [
        {
          num: "01",
          icon: "HowItWorks1",
          title: "Configura tu flota",
          desc: "Importa tus vehículos, conductores y puntos de servicio. Define turnos, depots y restricciones operativas de cada recurso.",
        },
        {
          num: "02",
          icon: "HowItWorks2",
          title: "Optimiza automáticamente",
          desc: "El motor VRP calcula la asignación óptima de rutas respetando jornadas, descansos, capacidad y distancias reales.",
        },
        {
          num: "03",
          icon: "HowItWorks3",
          title: "Ejecuta y controla",
          desc: "Publica los planes, gestiona incidencias en tiempo real y analiza métricas de rendimiento para mejorar cada día.",
        },
      ],
    },
    usecases: {
      tag: "Casos de uso",
      h2: "Diseñado para operaciones urbanas",
      sub: "Probado en los entornos más exigentes de servicios municipales.",
      items: [
        {
          icon: "Waste",
          title: "Recogida de residuos",
          desc: "Optimiza rutas de recogida RSU minimizando kilómetros en vacío. Gestiona turnos de noche y detecta ausencias antes de salir a calle.",
          tags: ["Rutas RSU", "Turno noche", "KPI operativo"],
          color: "#4f8ef7",
        },
        {
          icon: "Cleaning",
          title: "Limpieza viaria",
          desc: "Asigna zonas por barrio, gestiona cuadrillas y realiza seguimiento de incidencias de suciedad con fotos y geolocalización.",
          tags: ["Zonas barrio", "Cuadrillas", "Incidencias"],
          color: "#34d399",
        },
        {
          icon: "Maintenance",
          title: "Mantenimiento urbano",
          desc: "Crea planes de mantenimiento preventivo y correctivo. Gestiona el inventario de recambios y genera partes de inspección.",
          tags: ["Preventivo", "Correctivo", "Stock recambios"],
          color: "#a78bfa",
        },
      ],
    },
    pricing: {
      tag: "Precios",
      h2: "Sin sorpresas, sin letra pequeña",
      sub: "Planes adaptados al tamaño de tu operación.",
      plans: [
        {
          name: "Starter",
          price: "149",
          period: "/mes",
          desc: "Para flotas pequeñas que quieren empezar a digitalizar.",
          color: "#4f8ef7",
          features: [
            "Hasta 10 vehículos",
            "Módulos Planning + Incidencias",
            "1 organización",
            "Soporte por email",
          ],
          cta: "Empezar gratis",
          highlighted: false,
        },
        {
          name: "Professional",
          price: "349",
          period: "/mes",
          desc: "Para operadores que necesitan optimización y control total.",
          color: "#a78bfa",
          features: [
            "Hasta 50 vehículos",
            "Todos los módulos",
            "VRP multi-día",
            "Rostering + Scheduling",
            "Inventario + Movimientos",
            "Soporte prioritario",
          ],
          cta: "Solicitar demo",
          highlighted: true,
        },
        {
          name: "Enterprise",
          price: "Custom",
          period: "",
          desc: "Para grandes operadores con necesidades específicas.",
          color: "#34d399",
          features: [
            "Vehículos ilimitados",
            "Multi-tenant",
            "API + Integraciones",
            "SLA garantizado",
            "Onboarding dedicado",
            "Formación in situ",
          ],
          cta: "Contactar ventas",
          highlighted: false,
        },
      ],
    },
    about: {
      tag: "Empresa",
      h2: "Construido por expertos en operaciones",
      sub: "Nacimos de la frustración de gestionar flotas con hojas de cálculo. Creamos la herramienta que nos hubiera gustado tener.",
      mission: "Nuestra misión es digitalizarlas operaciones de flotas urbanas para hacerlas más eficientes, sostenibles y fáciles de gestionar — para que los equipos puedan centrarse en lo que importa.",
      values: [
        { icon: "Target",   title: "Enfoque operativo", desc: "Cada funcionalidad nace de un problema real en calle." },
        { icon: "Speed",    title: "Velocidad",          desc: "Iteramos rápido junto a nuestros clientes." },
        { icon: "Security", title: "Seguridad",          desc: "Datos en la nube con aislamiento multi-tenant." },
        { icon: "Leaf",     title: "Sostenibilidad",     desc: "Rutas optimizadas = menos emisiones." },
      ],
    },
    contact: {
      tag: "Contacto",
      h2: "Hablemos de tu operación",
      sub: "Cuéntanos cómo funciona tu flota y te mostramos cómo Operantia puede ayudarte.",
      name: "Nombre",
      company: "Empresa",
      email: "Email corporativo",
      message: "¿Qué necesitas gestionar?",
      send: "Enviar mensaje",
      sent: "¡Mensaje enviado! Te contactamos en 24h.",
      phone: "También puedes llamarnos:",
      phoneVal: "+34 900 000 000",
    },
    footer: {
      tagline: "La plataforma de operaciones para flotas urbanas.",
      product: "Producto",
      company: "Empresa",
      legal: "Legal",
      links: {
        product: ["Planning", "Scheduling", "Rostering", "Incidencias", "Inventario"],
        company: ["Sobre nosotros", "Blog", "Careers", "Partners"],
        legal: ["Privacidad", "Términos de uso", "Cookies"],
      },
      copy: "© 2025 Operantia. Todos los derechos reservados.",
    },
  },

  en: {
    nav: {
      product: "Product",
      modules: "Modules",
      pricing: "Pricing",
      about: "Company",
      login: "Log in",
      demo: "Request demo",
    },
    hero: {
      tag: "Operations platform",
      h1a: "Intelligent management",
      h1b: "of urban fleets",
      sub: "Plan routes, optimize schedules, manage shifts and track incidents — all in one integrated, real-time platform.",
      cta1: "Request demo",
      cta2: "See it in action",
      badge1: "VRP Planning",
      badge2: "Real-time",
      badge3: "Multi-tenant",
    },
    stats: [
      { value: "5", label: "Integrated modules" },
      { value: "VRP", label: "Route optimization" },
      { value: "Real-time", label: "Live data" },
      { value: "100%", label: "Cloud-based" },
    ],
    modules: {
      tag: "Modules",
      h2: "Everything you need, in one place",
      sub: "Each module is designed to cover a critical phase of urban fleet operations.",
      items: [
        {
          icon: "Planning",
          name: "Planning",
          desc: "Import KML files from your fleet, define geographic zones, assign colors by district and visualize your routes on an interactive map.",
          pills: ["KML import", "Interactive map", "Zones & districts"],
          color: "#4f8ef7",
        },
        {
          icon: "Scheduling",
          name: "Scheduling",
          desc: "Optimize driver assignment with VRP (Vehicle Routing Problem) algorithm. Generate automatic multi-day Gantt charts with shift constraints.",
          pills: ["VRP Algorithm", "Gantt Chart", "Multi-day"],
          color: "#a78bfa",
        },
        {
          icon: "Rostering",
          name: "Rostering",
          desc: "Manage your workers' availability calendar. Assign M/T/N shifts and automatically detect conflicts with the scheduling plan.",
          pills: ["Monthly grid", "Conflict detection", "Bulk assign"],
          color: "#34d399",
        },
        {
          icon: "Incidencias",
          name: "Incidents",
          desc: "Log, categorize and track operational incidents. Statistics, comments and status workflows for the management team.",
          pills: ["Categories", "Priorities", "Stats panel"],
          color: "#fb923c",
        },
        {
          icon: "Inventario",
          name: "Inventory",
          desc: "Control spare parts and materials stock. Low stock alerts, movement logs and full traceability per product.",
          pills: ["Stock control", "Low-stock alerts", "Movements"],
          color: "#fbbf24",
        },
        {
          icon: "Analytics",
          name: "Analytics",
          desc: "Visualize operational KPIs in real time: driver productivity, route compliance, incident trends and consumption patterns.",
          pills: ["Live KPIs", "Trends", "Export CSV"],
          color: "#22d3ee",
        },
      ],
    },
    howitworks: {
      tag: "How it works",
      h2: "From planning to execution",
      sub: "Three steps to transform how you manage your fleet.",
      steps: [
        {
          num: "01",
          icon: "HowItWorks1",
          title: "Configure your fleet",
          desc: "Import your vehicles, drivers and service points. Define shifts, depots and operational constraints for each resource.",
        },
        {
          num: "02",
          icon: "HowItWorks2",
          title: "Optimize automatically",
          desc: "The VRP engine calculates the optimal route assignment, respecting shift hours, breaks, capacity and real road distances.",
        },
        {
          num: "03",
          icon: "HowItWorks3",
          title: "Execute and monitor",
          desc: "Publish plans, manage incidents in real time and analyze performance metrics to improve operations every day.",
        },
      ],
    },
    usecases: {
      tag: "Use cases",
      h2: "Built for urban operations",
      sub: "Tested in the most demanding municipal service environments.",
      items: [
        {
          icon: "Waste",
          title: "Waste collection",
          desc: "Optimize waste collection routes minimizing empty mileage. Manage night shifts and detect absences before going out.",
          tags: ["Waste routes", "Night shift", "Operational KPIs"],
          color: "#4f8ef7",
        },
        {
          icon: "Cleaning",
          title: "Street cleaning",
          desc: "Assign zones by district, manage crews and track cleanliness incidents with photos and geolocation.",
          tags: ["District zones", "Crews", "Incidents"],
          color: "#34d399",
        },
        {
          icon: "Maintenance",
          title: "Urban maintenance",
          desc: "Create preventive and corrective maintenance plans. Manage spare parts inventory and generate inspection reports.",
          tags: ["Preventive", "Corrective", "Spare parts"],
          color: "#a78bfa",
        },
      ],
    },
    pricing: {
      tag: "Pricing",
      h2: "No surprises, no fine print",
      sub: "Plans tailored to the size of your operation.",
      plans: [
        {
          name: "Starter",
          price: "149",
          period: "/mo",
          desc: "For small fleets starting their digital journey.",
          color: "#4f8ef7",
          features: [
            "Up to 10 vehicles",
            "Planning + Incidents modules",
            "1 organization",
            "Email support",
          ],
          cta: "Start free",
          highlighted: false,
        },
        {
          name: "Professional",
          price: "349",
          period: "/mo",
          desc: "For operators who need full optimization and control.",
          color: "#a78bfa",
          features: [
            "Up to 50 vehicles",
            "All modules",
            "Multi-day VRP",
            "Rostering + Scheduling",
            "Inventory + Movements",
            "Priority support",
          ],
          cta: "Request demo",
          highlighted: true,
        },
        {
          name: "Enterprise",
          price: "Custom",
          period: "",
          desc: "For large operators with specific requirements.",
          color: "#34d399",
          features: [
            "Unlimited vehicles",
            "Multi-tenant",
            "API + Integrations",
            "Guaranteed SLA",
            "Dedicated onboarding",
            "On-site training",
          ],
          cta: "Contact sales",
          highlighted: false,
        },
      ],
    },
    about: {
      tag: "Company",
      h2: "Built by operations experts",
      sub: "We were born from the frustration of managing fleets with spreadsheets. We built the tool we wish we'd had.",
      mission: "Our mission is to digitalize urban fleet operations to make them more efficient, sustainable and easier to manage — so teams can focus on what matters.",
      values: [
        { icon: "Target",   title: "Operations focus", desc: "Every feature comes from a real problem in the field." },
        { icon: "Speed",    title: "Speed",             desc: "We iterate fast, together with our customers." },
        { icon: "Security", title: "Security",          desc: "Cloud data with multi-tenant isolation." },
        { icon: "Leaf",     title: "Sustainability",    desc: "Optimized routes = fewer emissions." },
      ],
    },
    contact: {
      tag: "Contact",
      h2: "Let's talk about your operation",
      sub: "Tell us how your fleet works and we'll show you how Operantia can help.",
      name: "Name",
      company: "Company",
      email: "Corporate email",
      message: "What do you need to manage?",
      send: "Send message",
      sent: "Message sent! We'll contact you within 24h.",
      phone: "You can also call us:",
      phoneVal: "+34 900 000 000",
    },
    footer: {
      tagline: "The operations platform for urban fleets.",
      product: "Product",
      company: "Company",
      legal: "Legal",
      links: {
        product: ["Planning", "Scheduling", "Rostering", "Incidents", "Inventory"],
        company: ["About us", "Blog", "Careers", "Partners"],
        legal: ["Privacy", "Terms of service", "Cookies"],
      },
      copy: "© 2025 Operantia. All rights reserved.",
    },
  },
};

// ── SCROLL REVEAL HOOK ─────────────────────────────────────────────
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); obs.unobserve(entry.target); } },
      { threshold: 0.12 }
    );
    const els = ref.current.querySelectorAll(".reveal");
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  return ref;
}

// ── SVG ICONS ─────────────────────────────────────────────────────
const IconArrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);
const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconMenu = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const IconX = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// ── LOGO ──────────────────────────────────────────────────────────
function Logo({ size = 28 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
      <div style={{
        width: size, height: size, borderRadius: 8,
        background: "linear-gradient(135deg, #4f8ef7, #6c6ef7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, fontSize: size * 0.55, color: "#fff",
        boxShadow: "0 4px 12px rgba(79,142,247,0.4)",
      }}>O</div>
      <span style={{ fontWeight: 800, fontSize: size * 0.72, color: "#f0f4f8", letterSpacing: -0.5 }}>Operantia</span>
    </div>
  );
}

// ── NAVBAR ────────────────────────────────────────────────────────
function NavBar({ lang, setLang, t }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navLink = (label, href) => (
    <a href={href} onClick={() => setOpen(false)} style={{
      color: "#94a3b8", fontSize: 14, fontWeight: 500,
      textDecoration: "none", transition: "color .15s",
    }}
      onMouseEnter={e => e.currentTarget.style.color = "#f0f4f8"}
      onMouseLeave={e => e.currentTarget.style.color = "#94a3b8"}
    >{label}</a>
  );

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "1px solid transparent",
      transition: "all .3s",
    }} className={scrolled || open ? "nav-blur" : ""}>
      <div className="container" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href="#" style={{ textDecoration: "none" }}><Logo /></a>

        {/* Desktop links */}
        <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {navLink(t.nav.product, "#modules")}
          {navLink(t.nav.modules, "#modules")}
          {navLink(t.nav.pricing, "#pricing")}
          {navLink(t.nav.about, "#about")}
        </div>

        {/* Right actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Language toggle */}
          <button onClick={() => setLang(lang === "es" ? "en" : "es")} style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, color: "#94a3b8", fontSize: 12, fontWeight: 700,
            padding: "5px 10px", cursor: "pointer", letterSpacing: 1,
            transition: "all .15s", fontFamily: "inherit",
          }}
            onMouseEnter={e => { e.currentTarget.style.color = "#f0f4f8"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
          >{lang === "es" ? "EN" : "ES"}</button>

          <a href={APP_URL} className="hide-mobile btn-outline" style={{ padding: "8px 16px", fontSize: 13 }}>
            {t.nav.login}
          </a>
          <a href="#contact" className="hide-mobile btn-primary" style={{ padding: "8px 16px", fontSize: 13 }}>
            {t.nav.demo}
          </a>

          {/* Hamburger */}
          <button className="hide-desktop" onClick={() => setOpen(!open)} style={{
            background: "none", border: "none", color: "#94a3b8", cursor: "pointer",
            display: "none",
          }}
            // show on mobile
          >
            {open ? <IconX /> : <IconMenu />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="nav-blur" style={{ padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {navLink(t.nav.product, "#modules")}
          {navLink(t.nav.modules, "#modules")}
          {navLink(t.nav.pricing, "#pricing")}
          {navLink(t.nav.about, "#about")}
          <a href={APP_URL} className="btn-outline" style={{ textAlign: "center" }}>{t.nav.login}</a>
          <a href="#contact" className="btn-primary" style={{ textAlign: "center", justifyContent: "center" }}>{t.nav.demo}</a>
        </div>
      )}
    </nav>
  );
}

// ── HERO ──────────────────────────────────────────────────────────
function HeroSection({ t }) {
  return (
    <section style={{ position: "relative", overflow: "hidden", paddingTop: 140, paddingBottom: 120 }} className="grid-bg">
      {/* Radial glow */}
      <div style={{
        position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)",
        width: 800, height: 500,
        background: "radial-gradient(ellipse at center, rgba(79,142,247,0.12) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: "60%", left: "25%",
        width: 400, height: 300,
        background: "radial-gradient(ellipse at center, rgba(167,139,250,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div className="container" style={{ position: "relative", textAlign: "center" }}>
        {/* Tag */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <span className="tag">✦ {t.hero.tag}</span>
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: "clamp(42px, 7vw, 80px)", fontWeight: 900,
          lineHeight: 1.05, letterSpacing: -2, color: "#f0f4f8",
          marginBottom: 24, maxWidth: 820, margin: "0 auto 24px",
        }}>
          <span className="grad-text">{t.hero.h1a}</span>
          <br />
          {t.hero.h1b}
        </h1>

        {/* Subtext */}
        <p style={{
          fontSize: "clamp(16px, 2vw, 20px)", color: "#8b95a5", lineHeight: 1.7,
          maxWidth: 620, margin: "0 auto 40px", fontWeight: 400,
        }}>{t.hero.sub}</p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 60 }}>
          <a href="#contact" className="btn-primary" style={{ fontSize: 16, padding: "16px 32px" }}>
            {t.hero.cta1} <IconArrow />
          </a>
          <a href="#modules" className="btn-outline" style={{ fontSize: 16, padding: "16px 32px" }}>
            {t.hero.cta2}
          </a>
        </div>

        {/* Badges */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {[
            { label: t.hero.badge1, color: "#4f8ef7" },
            { label: t.hero.badge2, color: "#34d399" },
            { label: t.hero.badge3, color: "#a78bfa" },
          ].map(b => (
            <span key={b.label} style={{
              padding: "6px 14px", borderRadius: 99, fontSize: 13, fontWeight: 600,
              background: `${b.color}15`, border: `1px solid ${b.color}33`, color: b.color,
            }}>● {b.label}</span>
          ))}
        </div>

        {/* App mockup */}
        <div className="animate-float" style={{ marginTop: 70, maxWidth: 960, margin: "70px auto 0" }}>
          <MockupGantt />
        </div>
      </div>
    </section>
  );
}

// ── GANTT MOCKUP ─────────────────────────────────────────────────
function MockupGantt() {
  const rows = [
    { name: "Carlos León",    color: "#4f8ef7", blocks: [{l:8,w:18},{l:30,w:8},{l:40,w:22},{l:65,w:12}] },
    { name: "Paco Perez",     color: "#a78bfa", blocks: [{l:5,w:25},{l:33,w:15},{l:52,w:18},{l:73,w:7}] },
    { name: "Andres Muñoz",   color: "#34d399", blocks: [{l:10,w:12},{l:26,w:20},{l:50,w:14},{l:68,w:16}] },
    { name: "Juan Álvarez",   color: "#fb923c", blocks: [{l:6,w:30},{l:40,w:10},{l:55,w:24}] },
  ];
  return (
    <div style={{
      background: "rgba(14,18,28,0.9)", borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(79,142,247,0.1)",
      overflow: "hidden",
    }}>
      {/* Toolbar */}
      <div style={{ height: 44, background: "#0d1120", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", padding: "0 16px", gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f87171" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fbbf24" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#34d399" }} />
        <span style={{ marginLeft: 16, fontSize: 12, color: "#3d4d63", fontWeight: 500 }}>Operantia · Scheduling</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {["06:00","08:00","10:00","12:00","14:00"].map(h => (
            <span key={h} style={{ fontSize: 10, color: "#3d4d63", width: 48, textAlign: "center" }}>{h}</span>
          ))}
        </div>
      </div>
      {/* Rows */}
      <div style={{ padding: "8px 0" }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 16px", gap: 0,
            background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
            <div style={{ width: 110, fontSize: 11, fontWeight: 600, color: "#8b95a5", flexShrink: 0 }}>{row.name}</div>
            <div style={{ flex: 1, position: "relative", height: 28 }}>
              {row.blocks.map((b, bi) => (
                <div key={bi} style={{
                  position: "absolute", left: `${b.l}%`, width: `${b.w}%`, height: "100%",
                  background: `${row.color}22`, border: `1px solid ${row.color}55`,
                  borderRadius: 5, display: "flex", alignItems: "center", paddingLeft: 6,
                }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── STATS BAR ────────────────────────────────────────────────────
function StatsBar({ t }) {
  const ref = useReveal();
  return (
    <section ref={ref} style={{ padding: "60px 0", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 32 }}>
          {t.stats.map((s, i) => (
            <div key={i} className="reveal" style={{ textAlign: "center", transitionDelay: `${i * 0.1}s` }}>
              <div style={{ fontSize: 36, fontWeight: 900, color: "#f0f4f8", letterSpacing: -1 }}
                className="grad-text">{s.value}</div>
              <div style={{ fontSize: 13, color: "#8b95a5", marginTop: 6, fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── MODULES ──────────────────────────────────────────────────────
function ModulesSection({ t }) {
  const ref = useReveal();
  const m = t.modules;
  return (
    <section id="modules" ref={ref} className="section" style={{ background: "rgba(8,12,20,1)" }}>
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag">{m.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 800, color: "#f0f4f8", letterSpacing: -1, marginBottom: 16, transitionDelay: "0.1s" }}>{m.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#8b95a5", maxWidth: 560, margin: "0 auto", transitionDelay: "0.2s" }}>{m.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          {m.items.map((mod, i) => (
            <div key={i} className="reveal glass" style={{
              borderRadius: 16, padding: 28, transition: "all .25s",
              transitionDelay: `${i * 0.1}s`,
              borderColor: `${mod.color}22`,
              cursor: "default",
            }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.borderColor = `${mod.color}55`;
                e.currentTarget.style.boxShadow = `0 20px 40px rgba(0,0,0,0.3), 0 0 0 1px ${mod.color}33`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = `${mod.color}22`;
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {/* Icon */}
              {(() => {
                const Icon = ModuleIcons[mod.icon];
                return (
                  <div style={{
                    width: 52, height: 52, borderRadius: 14,
                    background: `${mod.color}15`, border: `1px solid ${mod.color}30`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginBottom: 20, flexShrink: 0,
                  }}>
                    {Icon ? <Icon color={mod.color} /> : mod.icon}
                  </div>
                );
              })()}

              <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f0f4f8", marginBottom: 10 }}>{mod.name}</h3>
              <p style={{ fontSize: 14, color: "#8b95a5", lineHeight: 1.7, marginBottom: 16 }}>{mod.desc}</p>

              {/* Pills */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {mod.pills.map((p, pi) => (
                  <span key={pi} style={{
                    padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600,
                    background: `${mod.color}12`, color: mod.color, border: `1px solid ${mod.color}25`,
                  }}>{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── HOW IT WORKS ─────────────────────────────────────────────────
function HowItWorksSection({ t }) {
  const ref = useReveal();
  const h = t.howitworks;
  return (
    <section ref={ref} className="section" style={{ background: "rgba(10,14,22,1)", position: "relative", overflow: "hidden" }}>
      <div style={{
        position: "absolute", top: "50%", right: -100, transform: "translateY(-50%)",
        width: 600, height: 600,
        background: "radial-gradient(ellipse, rgba(79,142,247,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div className="container" style={{ position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag">{h.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 800, color: "#f0f4f8", letterSpacing: -1, marginBottom: 16, transitionDelay: "0.1s" }}>{h.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#8b95a5", maxWidth: 500, margin: "0 auto", transitionDelay: "0.2s" }}>{h.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 2, position: "relative" }}>
          {h.steps.map((step, i) => (
            <div key={i} className="reveal" style={{ padding: "36px 32px", position: "relative", transitionDelay: `${i * 0.15}s` }}>
              {/* Connector line */}
              {i < h.steps.length - 1 && (
                <div className="hide-mobile" style={{
                  position: "absolute", right: -1, top: "50%", transform: "translateY(-50%)",
                  width: 2, height: 60,
                  background: "linear-gradient(180deg, transparent, rgba(79,142,247,0.3), transparent)",
                }} />
              )}
              <div style={{ fontSize: 12, fontWeight: 800, color: "#4f8ef7", letterSpacing: 2, marginBottom: 20 }}>{step.num}</div>
              <div style={{
                width: 52, height: 52, borderRadius: 14, marginBottom: 16,
                background: "rgba(79,142,247,0.1)", border: "1px solid rgba(79,142,247,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {(() => { const Icon = ModuleIcons[step.icon]; return Icon ? <Icon color="#4f8ef7" /> : step.icon; })()}
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f0f4f8", marginBottom: 12 }}>{step.title}</h3>
              <p style={{ fontSize: 14, color: "#8b95a5", lineHeight: 1.7 }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── USE CASES ────────────────────────────────────────────────────
function UseCasesSection({ t }) {
  const ref = useReveal();
  const u = t.usecases;
  return (
    <section ref={ref} className="section" style={{ background: "#080c14" }}>
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag">{u.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 800, color: "#f0f4f8", letterSpacing: -1, marginBottom: 16, transitionDelay: "0.1s" }}>{u.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#8b95a5", maxWidth: 540, margin: "0 auto", transitionDelay: "0.2s" }}>{u.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {u.items.map((item, i) => (
            <div key={i} className="reveal glass" style={{
              borderRadius: 16, padding: 32,
              transitionDelay: `${i * 0.1}s`,
              transition: "all .25s",
              borderColor: `${item.color}22`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 20px 40px rgba(0,0,0,0.3), 0 0 0 1px ${item.color}33`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 14, marginBottom: 20,
                background: `${item.color}15`, border: `1px solid ${item.color}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {(() => { const Icon = ModuleIcons[item.icon]; return Icon ? <Icon color={item.color} /> : item.icon; })()}
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f0f4f8", marginBottom: 12 }}>{item.title}</h3>
              <p style={{ fontSize: 14, color: "#8b95a5", lineHeight: 1.7, marginBottom: 20 }}>{item.desc}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {item.tags.map((tag, ti) => (
                  <span key={ti} style={{
                    padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600,
                    background: "rgba(255,255,255,0.05)", color: "#8b95a5",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}>{tag}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── PRICING ──────────────────────────────────────────────────────
function PricingSection({ t }) {
  const ref = useReveal();
  const p = t.pricing;
  return (
    <section id="pricing" ref={ref} className="section" style={{ background: "rgba(10,14,22,1)", position: "relative", overflow: "hidden" }}>
      <div style={{
        position: "absolute", top: "40%", left: "50%", transform: "translate(-50%,-50%)",
        width: 700, height: 400,
        background: "radial-gradient(ellipse, rgba(167,139,250,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div className="container" style={{ position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag">{p.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 800, color: "#f0f4f8", letterSpacing: -1, marginBottom: 16, transitionDelay: "0.1s" }}>{p.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#8b95a5", maxWidth: 480, margin: "0 auto", transitionDelay: "0.2s" }}>{p.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, alignItems: "stretch" }}>
          {p.plans.map((plan, i) => (
            <div key={i} className="reveal" style={{
              borderRadius: 20, padding: 32,
              background: plan.highlighted ? `linear-gradient(135deg, ${plan.color}14, rgba(22,27,39,0.9))` : "rgba(22,27,39,0.6)",
              border: plan.highlighted ? `1px solid ${plan.color}44` : "1px solid rgba(255,255,255,0.07)",
              boxShadow: plan.highlighted ? `0 0 60px ${plan.color}15` : "none",
              transitionDelay: `${i * 0.1}s`,
              display: "flex", flexDirection: "column",
              position: "relative", overflow: "hidden",
              transition: "transform .25s",
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              {plan.highlighted && (
                <div style={{
                  position: "absolute", top: 16, right: 16,
                  padding: "3px 10px", borderRadius: 99, fontSize: 10, fontWeight: 700,
                  background: plan.color, color: "#fff", letterSpacing: 1,
                }}>POPULAR</div>
              )}

              <div style={{ fontSize: 13, fontWeight: 700, color: plan.color, letterSpacing: 1, marginBottom: 12 }}>{plan.name.toUpperCase()}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                {plan.price !== "Custom" ? (
                  <>
                    <span style={{ fontSize: 44, fontWeight: 900, color: "#f0f4f8", letterSpacing: -2 }}>€{plan.price}</span>
                    <span style={{ fontSize: 14, color: "#8b95a5" }}>{plan.period}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 36, fontWeight: 900, color: "#f0f4f8", letterSpacing: -1 }}>Custom</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "#8b95a5", marginBottom: 28 }}>{plan.desc}</p>

              <div style={{ flex: 1, marginBottom: 28 }}>
                {plan.features.map((f, fi) => (
                  <div key={fi} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                      background: `${plan.color}20`, border: `1px solid ${plan.color}44`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: plan.color,
                    }}><IconCheck /></div>
                    <span style={{ fontSize: 14, color: "#c4cdd8" }}>{f}</span>
                  </div>
                ))}
              </div>

              <a href="#contact" style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                textDecoration: "none",
                background: plan.highlighted ? plan.color : "rgba(255,255,255,0.05)",
                color: plan.highlighted ? "#fff" : "#c4cdd8",
                border: plan.highlighted ? "none" : "1px solid rgba(255,255,255,0.1)",
                transition: "all .2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
              >{plan.cta} <IconArrow /></a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── ABOUT ────────────────────────────────────────────────────────
function AboutSection({ t }) {
  const ref = useReveal();
  const a = t.about;
  return (
    <section id="about" ref={ref} className="section" style={{ background: "#080c14" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
          {/* Left */}
          <div>
            <div className="reveal" style={{ display: "flex", marginBottom: 20 }}>
              <span className="tag">{a.tag}</span>
            </div>
            <h2 className="reveal" style={{ fontSize: "clamp(26px,3.5vw,42px)", fontWeight: 800, color: "#f0f4f8", letterSpacing: -1, marginBottom: 20, lineHeight: 1.2, transitionDelay: "0.1s" }}>{a.h2}</h2>
            <p className="reveal" style={{ fontSize: 15, color: "#8b95a5", lineHeight: 1.8, marginBottom: 16, transitionDelay: "0.15s" }}>{a.sub}</p>
            <p className="reveal" style={{ fontSize: 15, color: "#8b95a5", lineHeight: 1.8, transitionDelay: "0.2s" }}>{a.mission}</p>
          </div>

          {/* Right — values grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {a.values.map((v, i) => (
              <div key={i} className="reveal glass" style={{
                borderRadius: 14, padding: 24, transitionDelay: `${0.1 + i * 0.1}s`,
                transition: "transform .25s",
              }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-3px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 10, marginBottom: 12,
                  background: "rgba(79,142,247,0.1)", border: "1px solid rgba(79,142,247,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {(() => { const Icon = ModuleIcons[v.icon]; return Icon ? <Icon color="#4f8ef7" /> : v.icon; })()}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f4f8", marginBottom: 6 }}>{v.title}</div>
                <div style={{ fontSize: 13, color: "#8b95a5", lineHeight: 1.6 }}>{v.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── CONTACT ──────────────────────────────────────────────────────
function ContactSection({ t }) {
  const ref = useReveal();
  const c = t.contact;
  const [form, setForm] = useState({ name: "", company: "", email: "", message: "" });
  const [sent, setSent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    // In production, connect to a form service (Formspree, Netlify, etc.)
    setSent(true);
  }

  const inp = (key, placeholder, multi = false) => {
    const base = {
      width: "100%", background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
      color: "#f0f4f8", fontSize: 14, fontFamily: "inherit",
      padding: "12px 14px", outline: "none", transition: "border-color .15s",
    };
    const handlers = {
      onFocus: e => { e.currentTarget.style.borderColor = "rgba(79,142,247,0.5)"; },
      onBlur:  e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; },
      value: form[key],
      onChange: e => setForm({ ...form, [key]: e.target.value }),
      placeholder,
    };
    return multi
      ? <textarea {...handlers} rows={4} style={{ ...base, resize: "vertical" }} />
      : <input type={key === "email" ? "email" : "text"} {...handlers} style={base} />;
  };

  return (
    <section id="contact" ref={ref} className="section" style={{ background: "rgba(10,14,22,1)", position: "relative", overflow: "hidden" }}>
      <div style={{
        position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: 600, height: 300,
        background: "radial-gradient(ellipse, rgba(79,142,247,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div className="container" style={{ position: "relative", maxWidth: 720 }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag">{c.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,46px)", fontWeight: 800, color: "#f0f4f8", letterSpacing: -1, marginBottom: 14, transitionDelay: "0.1s" }}>{c.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#8b95a5", transitionDelay: "0.2s" }}>{c.sub}</p>
        </div>

        <div className="reveal glass" style={{ borderRadius: 20, padding: 40 }}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <p style={{ fontSize: 18, fontWeight: 600, color: "#f0f4f8" }}>{c.sent}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#8b95a5", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.name}</label>
                  {inp("name", "Ana García")}
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#8b95a5", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.company}</label>
                  {inp("company", "Empresa SL")}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#8b95a5", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.email}</label>
                {inp("email", "ana@empresa.com")}
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#8b95a5", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.message}</label>
                {inp("message", "Gestionamos 30 vehículos de limpieza viaria…", true)}
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: 8, justifyContent: "center", fontSize: 15, padding: "14px 24px" }}>
                {c.send} <IconArrow />
              </button>
            </form>
          )}
        </div>

        <div className="reveal" style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: "#8b95a5" }}>
          {c.phone} <a href={`tel:${c.phoneVal.replace(/\s/g,"")}`} style={{ color: "#4f8ef7", textDecoration: "none", fontWeight: 600 }}>{c.phoneVal}</a>
        </div>
      </div>
    </section>
  );
}

// ── FOOTER ───────────────────────────────────────────────────────
function FooterSection({ t }) {
  const f = t.footer;
  const col = (title, links) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#4f8ef7", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 16 }}>{title}</div>
      {links.map((l, i) => (
        <a key={i} href="#" style={{ display: "block", fontSize: 14, color: "#8b95a5", textDecoration: "none", marginBottom: 10, transition: "color .15s" }}
          onMouseEnter={e => e.currentTarget.style.color = "#f0f4f8"}
          onMouseLeave={e => e.currentTarget.style.color = "#8b95a5"}
        >{l}</a>
      ))}
    </div>
  );

  return (
    <footer style={{ background: "#050810", borderTop: "1px solid rgba(255,255,255,0.05)", padding: "64px 0 32px" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48, marginBottom: 48 }}>
          <div>
            <Logo size={30} />
            <p style={{ fontSize: 14, color: "#8b95a5", marginTop: 16, lineHeight: 1.7, maxWidth: 260 }}>{f.tagline}</p>
            {/* Social links */}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              {["𝕏", "in", "gh"].map((s, i) => (
                <a key={i} href="#" style={{
                  width: 34, height: 34, borderRadius: 8,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#8b95a5", fontSize: 12, fontWeight: 700, textDecoration: "none",
                  transition: "all .15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(79,142,247,0.15)"; e.currentTarget.style.color = "#4f8ef7"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#8b95a5"; }}
                >{s}</a>
              ))}
            </div>
          </div>
          {col(f.product, f.links.product)}
          {col(f.company, f.links.company)}
          {col(f.legal, f.links.legal)}
        </div>

        <hr className="divider" style={{ marginBottom: 24 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 13, color: "#475569" }}>{f.copy}</p>
          <a href={APP_URL} className="btn-primary" style={{ padding: "8px 16px", fontSize: 13 }}>
            Acceder a la app <IconArrow />
          </a>
        </div>
      </div>
    </footer>
  );
}

// ── APP ──────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState("es");
  const t = T[lang];

  return (
    <>
      <NavBar lang={lang} setLang={setLang} t={t} />
      <main>
        <HeroSection t={t} />
        <StatsBar t={t} />
        <ModulesSection t={t} />
        <HowItWorksSection t={t} />
        <UseCasesSection t={t} />
        <PricingSection t={t} />
        <AboutSection t={t} />
        <ContactSection t={t} />
      </main>
      <FooterSection t={t} />
    </>
  );
}
