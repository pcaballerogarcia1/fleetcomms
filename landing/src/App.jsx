import { useState, useEffect, useRef } from "react";

// ── MODULE ICONS (SVG) ────────────────────────────────────────────
const ModuleIcons = {
  Planning: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/>
      <line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  ),
  Scheduling: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="7" y1="4" x2="7" y2="2"/>
      <line x1="17" y1="4" x2="17" y2="2"/>
      <rect x="7" y="13" width="3" height="2" rx="0.5" fill={color} stroke="none"/>
      <rect x="11" y="13" width="5" height="2" rx="0.5" fill={color} stroke="none" opacity="0.5"/>
    </svg>
  ),
  Rostering: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
      <line x1="15" y1="3" x2="15" y2="21"/>
    </svg>
  ),
  Incidencias: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <circle cx="12" cy="17" r="1" fill={color} stroke="none"/>
    </svg>
  ),
  Inventario: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  Analytics: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
      <line x1="3"  y1="20" x2="21" y2="20"/>
    </svg>
  ),
  Waste: ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  ),
  Cleaning: ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18"/>
      <path d="M5 21V7l8-4v18"/>
      <path d="M19 21V11l-6-4"/>
    </svg>
  ),
  Maintenance: ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  ),
  Target: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="6"/>
      <circle cx="12" cy="12" r="2" fill={color} stroke="none"/>
    </svg>
  ),
  Speed: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
  Security: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
  ),
  Leaf: ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
    </svg>
  ),
};

// ── APP URL ────────────────────────────────────────────────────────
const APP_URL = "https://app.operanzia.com";

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
      badge1: "Optimización VRP",
      badge2: "Datos en tiempo real",
      badge3: "Multi-empresa",
    },
    stats: [
      { value: "5", label: "Módulos integrados" },
      { value: "VRP", label: "Optimización de rutas" },
      { value: "Real-time", label: "Datos en vivo" },
      { value: "100%", label: "En la nube" },
    ],
    modules: {
      tag: "Plataforma",
      h2: "Todo lo que necesitas, integrado",
      sub: "Cada módulo cubre una fase crítica de la operación. Sin silos, sin exportaciones manuales: los datos fluyen entre módulos automáticamente.",
      items: [
        {
          icon: "Planning",
          name: "Planning",
          desc: "Importa archivos KML, define zonas geográficas y visualiza tus rutas en mapa interactivo con asignación por barrios.",
          pills: ["KML import", "Mapa interactivo", "Zonas y barrios"],
        },
        {
          icon: "Scheduling",
          name: "Scheduling",
          desc: "Motor VRP que genera el Gantt óptimo multi-día respetando jornadas, descansos y capacidad de cada vehículo.",
          pills: ["VRP Algorithm", "Gantt Chart", "Multi-día"],
        },
        {
          icon: "Rostering",
          name: "Rostering",
          desc: "Cuadrante mensual de disponibilidad con asignación M/T/N y detección automática de conflictos con el scheduling.",
          pills: ["Cuadrante mensual", "Detección conflictos", "Bulk assign"],
        },
        {
          icon: "Incidencias",
          name: "Incidencias",
          desc: "Registro, categorización y seguimiento de incidencias operativas con estadísticas y flujo de estados.",
          pills: ["Categorías", "Prioridades", "Panel estadístico"],
        },
        {
          icon: "Inventario",
          name: "Inventario",
          desc: "Control de stock de recambios con alertas de mínimos, registro de movimientos y trazabilidad completa.",
          pills: ["Control stock", "Alertas mínimos", "Movimientos"],
        },
        {
          icon: "Analytics",
          name: "Analytics",
          desc: "KPIs operativos en tiempo real: productividad, cumplimiento de rutas, evolución de incidencias y tendencias.",
          pills: ["KPIs en vivo", "Tendencias", "Exportar CSV"],
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
          title: "Configura tu flota",
          desc: "Importa tus vehículos, conductores y puntos de servicio. Define turnos, depots y restricciones operativas de cada recurso.",
        },
        {
          num: "02",
          title: "Optimiza automáticamente",
          desc: "El motor VRP calcula la asignación óptima de rutas respetando jornadas, descansos, capacidad y distancias reales.",
        },
        {
          num: "03",
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
        },
        {
          icon: "Cleaning",
          title: "Limpieza viaria",
          desc: "Asigna zonas por barrio, gestiona cuadrillas y realiza seguimiento de incidencias de suciedad con geolocalización.",
          tags: ["Zonas barrio", "Cuadrillas", "Incidencias"],
        },
        {
          icon: "Maintenance",
          title: "Mantenimiento urbano",
          desc: "Crea planes de mantenimiento preventivo y correctivo. Gestiona el inventario de recambios y genera partes de inspección.",
          tags: ["Preventivo", "Correctivo", "Stock recambios"],
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
      mission: "Nuestra misión es digitalizar las operaciones de flotas urbanas para hacerlas más eficientes, sostenibles y fáciles de gestionar — para que los equipos puedan centrarse en lo que importa.",
      values: [
        { icon: "Target",   title: "Enfoque operativo", desc: "Cada funcionalidad nace de un problema real en calle." },
        { icon: "Speed",    title: "Velocidad",          desc: "Iteramos rápido junto a nuestros clientes." },
        { icon: "Security", title: "Seguridad",          desc: "Datos en la nube con aislamiento multi-tenant." },
        { icon: "Leaf",     title: "Sostenibilidad",     desc: "Rutas optimizadas significan menos emisiones." },
      ],
    },
    contact: {
      tag: "Contacto",
      h2: "Hablemos de tu operación",
      sub: "Cuéntanos cómo funciona tu flota y te mostramos cómo Operanzia puede ayudarte.",
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
      copy: "© 2025 Operanzia. Todos los derechos reservados.",
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
      badge1: "VRP Optimization",
      badge2: "Real-time data",
      badge3: "Multi-tenant",
    },
    stats: [
      { value: "5", label: "Integrated modules" },
      { value: "VRP", label: "Route optimization" },
      { value: "Real-time", label: "Live data" },
      { value: "100%", label: "Cloud-based" },
    ],
    modules: {
      tag: "Platform",
      h2: "Everything you need, integrated",
      sub: "Each module covers a critical operational phase. No silos, no manual exports — data flows between modules automatically.",
      items: [
        {
          icon: "Planning",
          name: "Planning",
          desc: "Import KML files, define geographic zones and visualize your routes on an interactive map with district assignment.",
          pills: ["KML import", "Interactive map", "Zones & districts"],
        },
        {
          icon: "Scheduling",
          name: "Scheduling",
          desc: "VRP engine that generates the optimal multi-day Gantt chart respecting shifts, breaks and vehicle capacity.",
          pills: ["VRP Algorithm", "Gantt Chart", "Multi-day"],
        },
        {
          icon: "Rostering",
          name: "Rostering",
          desc: "Monthly availability calendar with M/T/N shift assignment and automatic conflict detection with scheduling.",
          pills: ["Monthly grid", "Conflict detection", "Bulk assign"],
        },
        {
          icon: "Incidencias",
          name: "Incidents",
          desc: "Log, categorize and track operational incidents with statistics and status workflows.",
          pills: ["Categories", "Priorities", "Stats panel"],
        },
        {
          icon: "Inventario",
          name: "Inventory",
          desc: "Spare parts stock control with low-stock alerts, movement logs and full traceability per product.",
          pills: ["Stock control", "Low-stock alerts", "Movements"],
        },
        {
          icon: "Analytics",
          name: "Analytics",
          desc: "Real-time operational KPIs: productivity, route compliance, incident trends and consumption patterns.",
          pills: ["Live KPIs", "Trends", "Export CSV"],
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
          title: "Configure your fleet",
          desc: "Import your vehicles, drivers and service points. Define shifts, depots and operational constraints for each resource.",
        },
        {
          num: "02",
          title: "Optimize automatically",
          desc: "The VRP engine calculates the optimal route assignment, respecting shift hours, breaks, capacity and real road distances.",
        },
        {
          num: "03",
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
        },
        {
          icon: "Cleaning",
          title: "Street cleaning",
          desc: "Assign zones by district, manage crews and track cleanliness incidents with geolocation.",
          tags: ["District zones", "Crews", "Incidents"],
        },
        {
          icon: "Maintenance",
          title: "Urban maintenance",
          desc: "Create preventive and corrective maintenance plans. Manage spare parts inventory and generate inspection reports.",
          tags: ["Preventive", "Corrective", "Spare parts"],
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
        { icon: "Leaf",     title: "Sustainability",    desc: "Optimized routes mean fewer emissions." },
      ],
    },
    contact: {
      tag: "Contact",
      h2: "Let's talk about your operation",
      sub: "Tell us how your fleet works and we'll show you how Operanzia can help.",
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
      copy: "© 2025 Operanzia. All rights reserved.",
    },
  },
};

// ── SCROLL REVEAL ─────────────────────────────────────────────────
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); obs.unobserve(entry.target); } },
      { threshold: 0.1 }
    );
    ref.current.querySelectorAll(".reveal").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  return ref;
}

// ── ICONS ─────────────────────────────────────────────────────────
const IconArrow = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);
const IconCheck = ({ color }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconMenu = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// ── LOGO ──────────────────────────────────────────────────────────
function Logo({ size = 28, textColor = "#0f172a" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{
        width: size, height: size, borderRadius: 7,
        background: "linear-gradient(135deg, #2563eb, #6d28d9)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, fontSize: size * 0.52, color: "#fff",
        letterSpacing: "-0.5px", flexShrink: 0,
        boxShadow: "0 2px 8px rgba(37,99,235,0.35)",
      }}>O</div>
      <span style={{ fontWeight: 700, fontSize: size * 0.72, color: textColor, letterSpacing: "-0.02em" }}>Operanzia</span>
    </div>
  );
}

// ── NAVBAR ────────────────────────────────────────────────────────
function NavBar({ lang, setLang, t }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 64);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const lc = scrolled ? "#475569" : "rgba(255,255,255,0.65)";
  const lh = scrolled ? "#0f172a" : "#ffffff";

  const navLink = (label, href) => (
    <a href={href} onClick={() => setOpen(false)} style={{
      color: lc, fontSize: 14, fontWeight: 500, textDecoration: "none", transition: "color .15s",
    }}
      onMouseEnter={e => e.currentTarget.style.color = lh}
      onMouseLeave={e => e.currentTarget.style.color = lc}
    >{label}</a>
  );

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      background: scrolled ? "rgba(255,255,255,0.97)" : "transparent",
      borderBottom: scrolled ? "1px solid #f1f5f9" : "1px solid transparent",
      boxShadow: scrolled ? "0 1px 6px rgba(0,0,0,0.06)" : "none",
      backdropFilter: scrolled ? "blur(16px)" : "none",
      WebkitBackdropFilter: scrolled ? "blur(16px)" : "none",
      transition: "all .3s cubic-bezier(.4,0,.2,1)",
    }}>
      <div className="container" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href="#" style={{ textDecoration: "none" }}>
          <Logo textColor={scrolled ? "#0f172a" : "#ffffff"} />
        </a>

        <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {navLink(t.nav.product, "#modules")}
          {navLink(t.nav.modules, "#modules")}
          {navLink(t.nav.pricing, "#pricing")}
          {navLink(t.nav.about, "#about")}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setLang(lang === "es" ? "en" : "es")} style={{
            background: scrolled ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.08)",
            border: scrolled ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(255,255,255,0.15)",
            borderRadius: 7, color: scrolled ? "#475569" : "rgba(255,255,255,0.6)",
            fontSize: 11, fontWeight: 700, padding: "5px 10px", cursor: "pointer",
            letterSpacing: "0.05em", transition: "all .15s", fontFamily: "inherit",
          }}>{lang === "es" ? "EN" : "ES"}</button>

          <a href={APP_URL} className="hide-mobile" style={{
            fontSize: 13, fontWeight: 500, textDecoration: "none", padding: "7px 14px",
            borderRadius: 8, transition: "all .15s",
            color: scrolled ? "#475569" : "rgba(255,255,255,0.65)",
            background: scrolled ? "transparent" : "transparent",
            border: scrolled ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.18)",
          }}
            onMouseEnter={e => { e.currentTarget.style.color = scrolled ? "#0f172a" : "#ffffff"; e.currentTarget.style.borderColor = scrolled ? "#94a3b8" : "rgba(255,255,255,0.40)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = scrolled ? "#475569" : "rgba(255,255,255,0.65)"; e.currentTarget.style.borderColor = scrolled ? "#e2e8f0" : "rgba(255,255,255,0.18)"; }}
          >{t.nav.login}</a>

          <a href="#contact" className="hide-mobile" style={{
            fontSize: 13, fontWeight: 600, textDecoration: "none", padding: "7px 16px",
            borderRadius: 8, transition: "all .18s", fontFamily: "inherit",
            background: scrolled ? "#1e40af" : "#ffffff",
            color: scrolled ? "#ffffff" : "#0f172a",
            boxShadow: scrolled ? "0 1px 3px rgba(30,64,175,0.25)" : "0 1px 4px rgba(0,0,0,0.20)",
          }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.88"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; }}
          >{t.nav.demo}</a>

          <button onClick={() => setOpen(!open)} style={{
            background: "none", border: "none",
            color: scrolled ? "#475569" : "rgba(255,255,255,0.7)",
            cursor: "pointer", display: "none", padding: 4,
          }} className="hide-desktop">{open ? <IconX /> : <IconMenu />}</button>
        </div>
      </div>

      {open && (
        <div style={{
          padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 16,
          borderTop: "1px solid #e2e8f0", background: "#ffffff",
        }}>
          {[
            [t.nav.product, "#modules"], [t.nav.modules, "#modules"],
            [t.nav.pricing, "#pricing"], [t.nav.about, "#about"],
          ].map(([l, h]) => (
            <a key={l} href={h} onClick={() => setOpen(false)} style={{ color: "#475569", fontSize: 15, textDecoration: "none" }}>{l}</a>
          ))}
          <a href={APP_URL} style={{ textAlign: "center", padding: "11px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, color: "#475569", textDecoration: "none" }}>{t.nav.login}</a>
          <a href="#contact" onClick={() => setOpen(false)} style={{ textAlign: "center", padding: "11px", borderRadius: 8, fontSize: 14, color: "#fff", background: "#1e40af", textDecoration: "none" }}>{t.nav.demo}</a>
        </div>
      )}
    </nav>
  );
}

// ── APP MOCKUP (browser chrome + gantt) ──────────────────────────
function MockupGantt() {
  const rows = [
    { name: "Carlos León",   color: "#3b82f6", blocks: [{l:8,w:18},{l:30,w:10},{l:44,w:20},{l:68,w:11}] },
    { name: "Paco Pérez",    color: "#8b5cf6", blocks: [{l:5,w:24},{l:34,w:14},{l:53,w:17},{l:74,w:8}] },
    { name: "Andrés Muñoz",  color: "#10b981", blocks: [{l:11,w:13},{l:28,w:19},{l:51,w:15},{l:70,w:14}] },
    { name: "Juan Álvarez",  color: "#f59e0b", blocks: [{l:6,w:28},{l:38,w:11},{l:54,w:22}] },
    { name: "María Torres",  color: "#ec4899", blocks: [{l:13,w:21},{l:39,w:16},{l:60,w:19}] },
  ];
  const sideItems = ["P","S","R","I","Inv","A"];

  return (
    <div style={{
      borderRadius: 14, overflow: "hidden",
      boxShadow: "0 48px 96px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07)",
    }}>
      {/* Browser chrome */}
      <div style={{
        background: "#141d2e", padding: "0 16px",
        height: 44, display: "flex", alignItems: "center", gap: 12,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f56" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27c840" }} />
        </div>
        <div style={{
          flex: 1, maxWidth: 320, margin: "0 auto",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 7, height: 26, display: "flex", alignItems: "center",
          padding: "0 10px", gap: 7,
        }}>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="#27c840"><circle cx="6" cy="6" r="6"/></svg>
          <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.38)", letterSpacing: "0.01em", fontFamily: "monospace" }}>
            app.operanzia.com/scheduling
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, opacity: 0.2 }}>
          {[16, 12, 10].map(w => <div key={w} style={{ width: w, height: 3, background: "#fff", borderRadius: 2 }} />)}
        </div>
      </div>

      {/* App layout */}
      <div style={{ display: "flex", background: "#0c1525" }}>
        {/* Sidebar */}
        <div style={{
          width: 48, background: "#080f1e", borderRight: "1px solid rgba(255,255,255,0.05)",
          display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0", gap: 4,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, marginBottom: 12,
            background: "linear-gradient(135deg, #2563eb, #7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 900, color: "#fff",
          }}>O</div>
          {sideItems.map((l, i) => (
            <div key={l} style={{
              width: 32, height: 32, borderRadius: 7,
              background: l === "S" ? "rgba(59,130,246,0.18)" : "transparent",
              border: l === "S" ? "1px solid rgba(59,130,246,0.35)" : "1px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9.5, color: l === "S" ? "#60a5fa" : "rgba(255,255,255,0.18)",
              fontWeight: 700, letterSpacing: "0.02em",
            }}>{l}</div>
          ))}
        </div>

        {/* Main area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* App header */}
          <div style={{
            height: 44, display: "flex", alignItems: "center", padding: "0 16px",
            borderBottom: "1px solid rgba(255,255,255,0.05)", gap: 12,
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#e2e8f0", letterSpacing: "-0.01em" }}>Scheduling</span>
            <span style={{
              fontSize: 10.5, color: "#475569", padding: "2px 8px",
              background: "rgba(255,255,255,0.04)", borderRadius: 5, border: "1px solid rgba(255,255,255,0.06)",
            }}>Semana 26 · 2025</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
              {["Exportar", "Publicar"].map((btn, i) => (
                <div key={btn} style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: "default",
                  background: i === 1 ? "#2563eb" : "rgba(255,255,255,0.05)",
                  color: i === 1 ? "#fff" : "#64748b",
                  border: i === 1 ? "none" : "1px solid rgba(255,255,255,0.07)",
                }}>{btn}</div>
              ))}
            </div>
          </div>

          {/* Time ruler */}
          <div style={{
            display: "flex", paddingLeft: 116,
            background: "rgba(0,0,0,0.25)", borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            {["06:00","08:00","10:00","12:00","14:00","16:00"].map(h => (
              <div key={h} style={{ flex: 1, padding: "5px 0", fontSize: 9, color: "#334155", fontWeight: 500, textAlign: "center" }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {rows.map((row, ri) => (
            <div key={ri} style={{
              display: "flex", alignItems: "center", height: 38,
              borderBottom: "1px solid rgba(255,255,255,0.025)",
              background: ri === 1 ? "rgba(59,130,246,0.035)" : "transparent",
            }}>
              <div style={{
                width: 116, padding: "0 14px", fontSize: 10.5, fontWeight: 500,
                color: "#4b5563", flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden",
              }}>{row.name}</div>
              <div style={{ flex: 1, position: "relative", height: "100%", padding: "6px 0" }}>
                {row.blocks.map((b, bi) => (
                  <div key={bi} style={{
                    position: "absolute", left: `${b.l}%`, width: `${b.w}%`,
                    height: "calc(100% - 12px)",
                    background: `${row.color}1a`, border: `1px solid ${row.color}50`,
                    borderLeft: `2px solid ${row.color}cc`,
                    borderRadius: "0 4px 4px 0",
                    display: "flex", alignItems: "center", paddingLeft: 6,
                  }}>
                    <div style={{ width: 4, height: 4, borderRadius: "50%", background: row.color, opacity: 0.75 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Status bar */}
          <div style={{
            padding: "7px 14px 7px 130px", display: "flex", gap: 18, alignItems: "center",
            borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.18)",
          }}>
            {[["#10b981","5 turnos activos"],["#f59e0b","1 conflicto"],["#3b82f6","96% cobertura"]].map(([c, l]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />
                <span style={{ fontSize: 9.5, color: "#475569", fontWeight: 500 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── HERO ──────────────────────────────────────────────────────────
function HeroSection({ t }) {
  return (
    <section style={{
      position: "relative", overflow: "hidden",
      background: "#05091a",
      paddingTop: 152, paddingBottom: 96,
    }}>
      {/* Dot grid overlay */}
      <div className="grid-bg" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

      {/* Blue radial glow — center */}
      <div style={{
        position: "absolute", top: "18%", left: "50%", transform: "translateX(-50%)",
        width: 1000, height: 700, pointerEvents: "none",
        background: "radial-gradient(ellipse at center, rgba(37,99,235,0.20) 0%, transparent 62%)",
      }} />
      {/* Purple glow — top right */}
      <div style={{
        position: "absolute", top: "5%", right: "5%",
        width: 500, height: 500, pointerEvents: "none",
        background: "radial-gradient(ellipse, rgba(109,40,217,0.12) 0%, transparent 65%)",
      }} />

      <div className="container" style={{ position: "relative", textAlign: "center" }}>
        {/* Tag */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }} className="animate-fadein">
          <span className="tag">{t.hero.tag}</span>
        </div>

        {/* Headline */}
        <h1 className="animate-fadeup" style={{
          fontSize: "clamp(46px, 7vw, 90px)", fontWeight: 800,
          lineHeight: 1.04, letterSpacing: "-0.04em",
          maxWidth: 900, margin: "0 auto 26px",
        }}>
          <span className="grad-text">{t.hero.h1a}</span>
          <br />
          <span style={{ color: "rgba(255,255,255,0.90)" }}>{t.hero.h1b}</span>
        </h1>

        {/* Subtext */}
        <p className="animate-fadeup" style={{
          fontSize: "clamp(15px, 1.6vw, 18px)", color: "rgba(255,255,255,0.48)",
          lineHeight: 1.78, maxWidth: 540, margin: "0 auto 44px",
          animationDelay: "0.08s",
        }}>{t.hero.sub}</p>

        {/* CTAs */}
        <div className="animate-fadeup" style={{
          display: "flex", gap: 12, justifyContent: "center",
          flexWrap: "wrap", marginBottom: 48, animationDelay: "0.14s",
        }}>
          <a href="#contact" className="btn-hero" style={{ fontSize: 14, padding: "12px 24px" }}>
            {t.hero.cta1} <IconArrow />
          </a>
          <a href="#modules" className="btn-hero-outline" style={{ fontSize: 14, padding: "11px 24px" }}>
            {t.hero.cta2}
          </a>
        </div>

        {/* Trust badges */}
        <div className="animate-fadein" style={{
          display: "flex", gap: 28, justifyContent: "center",
          flexWrap: "wrap", marginBottom: 64, animationDelay: "0.22s",
        }}>
          {[t.hero.badge1, t.hero.badge2, t.hero.badge3].map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: ["#3b82f6","#10b981","#8b5cf6"][i], boxShadow: `0 0 6px ${["#3b82f6","#10b981","#8b5cf6"][i]}` }} />
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.01em" }}>{b}</span>
            </div>
          ))}
        </div>

        {/* Product screenshot */}
        <div className="animate-fadeup" style={{ maxWidth: 960, margin: "0 auto", animationDelay: "0.28s" }}>
          <MockupGantt />
        </div>
      </div>

      {/* Bottom edge glow */}
      <div style={{
        position: "absolute", bottom: -2, left: 0, right: 0,
        height: 2, background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.5), transparent)",
        pointerEvents: "none",
      }} />
    </section>
  );
}

// ── STATS BAR ────────────────────────────────────────────────────
function StatsBar({ t }) {
  const ref = useReveal();
  return (
    <section ref={ref} style={{ padding: "52px 0", background: "#ffffff", borderBottom: "1px solid #f1f5f9" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0 }}>
          {t.stats.map((s, i) => (
            <div key={i} className="reveal" style={{
              textAlign: "center", padding: "8px 24px",
              borderRight: i < 3 ? "1px solid #f1f5f9" : "none",
              transitionDelay: `${i * 0.08}s`,
            }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.04em", lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 8, fontWeight: 500 }}>{s.label}</div>
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
  const ACCENT = "#2563eb";
  return (
    <section id="modules" ref={ref} className="section" style={{ background: "#f8fafc" }}>
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag-light">{m.tag}</span>
          </div>
          <h2 className="reveal" style={{
            fontSize: "clamp(28px,4vw,50px)", fontWeight: 800, color: "#0f172a",
            letterSpacing: "-0.03em", marginBottom: 16, lineHeight: 1.1,
            transitionDelay: "0.1s",
          }}>{m.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#64748b", maxWidth: 560, margin: "0 auto", lineHeight: 1.7, transitionDelay: "0.18s" }}>{m.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          {m.items.map((mod, i) => {
            const Icon = ModuleIcons[mod.icon];
            return (
              <div key={i} className="reveal" style={{
                background: "#ffffff", borderRadius: 12, padding: 28,
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                transition: "all .22s cubic-bezier(.4,0,.2,1)",
                transitionDelay: `${i * 0.07}s`,
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = "translateY(-3px)";
                  e.currentTarget.style.boxShadow = "0 10px 28px rgba(0,0,0,0.09)";
                  e.currentTarget.style.borderColor = "#c7d2fe";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.03)";
                  e.currentTarget.style.borderColor = "#e2e8f0";
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 10, marginBottom: 18,
                  background: "#eff6ff", border: "1px solid #bfdbfe",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {Icon ? <Icon color={ACCENT} /> : null}
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 8, letterSpacing: "-0.01em" }}>{mod.name}</h3>
                <p style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.7, marginBottom: 16 }}>{mod.desc}</p>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {mod.pills.map((p, pi) => (
                    <span key={pi} style={{
                      padding: "3px 9px", borderRadius: 5, fontSize: 10.5, fontWeight: 600,
                      background: "#f8fafc", color: "#64748b", border: "1px solid #e2e8f0",
                      letterSpacing: "0.01em",
                    }}>{p}</span>
                  ))}
                </div>
              </div>
            );
          })}
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
    <section ref={ref} className="section" style={{ background: "#ffffff" }}>
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 72 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag-light">{h.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,50px)", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 16, transitionDelay: "0.1s" }}>{h.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#64748b", maxWidth: 480, margin: "0 auto", transitionDelay: "0.18s" }}>{h.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 0 }}>
          {h.steps.map((step, i) => (
            <div key={i} className="reveal" style={{
              padding: "44px 40px", position: "relative",
              borderRight: i < h.steps.length - 1 ? "1px solid #f1f5f9" : "none",
              transitionDelay: `${i * 0.14}s`,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%", marginBottom: 24,
                background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.03em",
              }}>{step.num}</div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 10, letterSpacing: "-0.02em" }}>{step.title}</h3>
              <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.75 }}>{step.desc}</p>
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
    <section ref={ref} className="section" style={{ background: "#f8fafc" }}>
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag-light">{u.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,50px)", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 16, transitionDelay: "0.1s" }}>{u.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#64748b", maxWidth: 520, margin: "0 auto", transitionDelay: "0.18s" }}>{u.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          {u.items.map((item, i) => {
            const Icon = ModuleIcons[item.icon];
            return (
              <div key={i} className="reveal" style={{
                background: "#ffffff", borderRadius: 12, padding: 32,
                border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                transition: "all .22s", transitionDelay: `${i * 0.1}s`,
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 28px rgba(0,0,0,0.09)"; e.currentTarget.style.borderColor = "#c7d2fe"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.03)"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
              >
                <div style={{
                  width: 46, height: 46, borderRadius: 12, marginBottom: 20,
                  background: "#f1f5f9", border: "1px solid #e2e8f0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {Icon ? <Icon color="#334155" /> : null}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", marginBottom: 10, letterSpacing: "-0.01em" }}>{item.title}</h3>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.72, marginBottom: 20 }}>{item.desc}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {item.tags.map((tag, ti) => (
                    <span key={ti} style={{
                      padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600,
                      background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0",
                    }}>{tag}</span>
                  ))}
                </div>
              </div>
            );
          })}
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
    <section id="pricing" ref={ref} className="section" style={{ background: "#ffffff" }}>
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag-light">{p.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,50px)", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 16, transitionDelay: "0.1s" }}>{p.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#64748b", maxWidth: 460, margin: "0 auto", transitionDelay: "0.18s" }}>{p.sub}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, alignItems: "start" }}>
          {p.plans.map((plan, i) => (
            <div key={i} className="reveal" style={{
              borderRadius: 14, overflow: "hidden",
              background: "#ffffff",
              border: plan.highlighted ? "1.5px solid #2563eb" : "1px solid #e2e8f0",
              boxShadow: plan.highlighted ? "0 8px 32px rgba(37,99,235,0.12)" : "0 1px 3px rgba(0,0,0,0.04)",
              transitionDelay: `${i * 0.1}s`,
              transition: "transform .22s, box-shadow .22s",
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = plan.highlighted ? "0 16px 40px rgba(37,99,235,0.18)" : "0 10px 28px rgba(0,0,0,0.09)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = plan.highlighted ? "0 8px 32px rgba(37,99,235,0.12)" : "0 1px 3px rgba(0,0,0,0.04)"; }}
            >
              {plan.highlighted && (
                <div style={{ height: 3, background: "linear-gradient(90deg, #2563eb, #7c3aed)" }} />
              )}
              <div style={{ padding: 32, position: "relative" }}>
                {plan.highlighted && (
                  <div style={{
                    position: "absolute", top: 24, right: 24,
                    padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: "#2563eb", color: "#fff", letterSpacing: "0.06em",
                  }}>POPULAR</div>
                )}

                <div style={{ fontSize: 11, fontWeight: 700, color: plan.highlighted ? "#2563eb" : "#94a3b8", letterSpacing: "0.08em", marginBottom: 14 }}>{plan.name.toUpperCase()}</div>

                <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 8 }}>
                  {plan.price !== "Custom" ? (
                    <>
                      <span style={{ fontSize: 46, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.04em", lineHeight: 1 }}>€{plan.price}</span>
                      <span style={{ fontSize: 14, color: "#94a3b8" }}>{plan.period}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 38, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.03em" }}>Custom</span>
                  )}
                </div>
                <p style={{ fontSize: 13.5, color: "#64748b", marginBottom: 28, lineHeight: 1.6 }}>{plan.desc}</p>

                <div style={{ marginBottom: 28 }}>
                  {plan.features.map((f, fi) => (
                    <div key={fi} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                        background: plan.highlighted ? "#dbeafe" : "#f1f5f9",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <IconCheck color={plan.highlighted ? "#2563eb" : "#64748b"} />
                      </div>
                      <span style={{ fontSize: 13.5, color: "#334155" }}>{f}</span>
                    </div>
                  ))}
                </div>

                <a href="#contact" style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  padding: "12px 20px", borderRadius: 9, fontSize: 14, fontWeight: 600,
                  textDecoration: "none", transition: "all .18s",
                  background: plan.highlighted ? "#1e40af" : "#f8fafc",
                  color: plan.highlighted ? "#fff" : "#334155",
                  border: plan.highlighted ? "none" : "1px solid #e2e8f0",
                }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "0.88"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                >{plan.cta} <IconArrow /></a>
              </div>
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
    <section id="about" ref={ref} className="section" style={{ background: "#f8fafc" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
          <div>
            <div className="reveal" style={{ display: "flex", marginBottom: 20 }}>
              <span className="tag-light">{a.tag}</span>
            </div>
            <h2 className="reveal" style={{ fontSize: "clamp(26px,3.5vw,44px)", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 20, lineHeight: 1.15, transitionDelay: "0.1s" }}>{a.h2}</h2>
            <p className="reveal" style={{ fontSize: 15, color: "#64748b", lineHeight: 1.8, marginBottom: 14, transitionDelay: "0.15s" }}>{a.sub}</p>
            <p className="reveal" style={{ fontSize: 15, color: "#64748b", lineHeight: 1.8, transitionDelay: "0.2s" }}>{a.mission}</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {a.values.map((v, i) => {
              const Icon = ModuleIcons[v.icon];
              return (
                <div key={i} className="reveal" style={{
                  borderRadius: 12, padding: 22,
                  background: "#ffffff", border: "1px solid #e2e8f0",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  transitionDelay: `${0.1 + i * 0.08}s`,
                  transition: "all .2s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.03)"; }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 9, marginBottom: 12,
                    background: "#eff6ff", border: "1px solid #bfdbfe",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {Icon ? <Icon color="#2563eb" /> : null}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginBottom: 5 }}>{v.title}</div>
                  <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6 }}>{v.desc}</div>
                </div>
              );
            })}
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

  const handleSubmit = e => { e.preventDefault(); setSent(true); };

  const inp = (key, placeholder, multi = false) => {
    const base = {
      width: "100%", background: "#f8fafc",
      border: "1px solid #e2e8f0", borderRadius: 9,
      color: "#0f172a", fontSize: 14, fontFamily: "inherit",
      padding: "11px 13px", outline: "none", transition: "border-color .15s, box-shadow .15s",
    };
    const handlers = {
      onFocus: e => { e.currentTarget.style.borderColor = "#93c5fd"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(147,197,253,0.25)"; },
      onBlur:  e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.boxShadow = "none"; },
      value: form[key],
      onChange: e => setForm({ ...form, [key]: e.target.value }),
      placeholder,
    };
    return multi
      ? <textarea {...handlers} rows={4} style={{ ...base, resize: "vertical" }} />
      : <input type={key === "email" ? "email" : "text"} {...handlers} style={base} />;
  };

  return (
    <section id="contact" ref={ref} className="section" style={{ background: "#ffffff" }}>
      <div className="container" style={{ maxWidth: 720 }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div className="reveal" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="tag-light">{c.tag}</span>
          </div>
          <h2 className="reveal" style={{ fontSize: "clamp(28px,4vw,50px)", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 14, transitionDelay: "0.1s" }}>{c.h2}</h2>
          <p className="reveal" style={{ fontSize: 17, color: "#64748b", transitionDelay: "0.18s" }}>{c.sub}</p>
        </div>

        <div className="reveal" style={{
          background: "#ffffff", borderRadius: 14,
          border: "1px solid #e2e8f0", padding: 40,
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
        }}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", background: "#dbeafe",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px", fontSize: 24,
              }}>✓</div>
              <p style={{ fontSize: 17, fontWeight: 600, color: "#0f172a" }}>{c.sent}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.name}</label>
                  {inp("name", "Ana García")}
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.company}</label>
                  {inp("company", "Empresa SL")}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.email}</label>
                {inp("email", "ana@empresa.com")}
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 6, display: "block" }}>{c.message}</label>
                {inp("message", "Gestionamos 30 vehículos de limpieza viaria…", true)}
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: 6, justifyContent: "center", fontSize: 15, padding: "13px 24px" }}>
                {c.send} <IconArrow />
              </button>
            </form>
          )}
        </div>

        <div className="reveal" style={{ textAlign: "center", marginTop: 22, fontSize: 13, color: "#94a3b8" }}>
          {c.phone}{" "}
          <a href={`tel:${c.phoneVal.replace(/\s/g, "")}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>{c.phoneVal}</a>
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
      <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>{title}</div>
      {links.map((l, i) => (
        <a key={i} href="#" style={{ display: "block", fontSize: 13.5, color: "#8b95a5", textDecoration: "none", marginBottom: 10, transition: "color .15s" }}
          onMouseEnter={e => e.currentTarget.style.color = "#e2e8f0"}
          onMouseLeave={e => e.currentTarget.style.color = "#8b95a5"}
        >{l}</a>
      ))}
    </div>
  );

  return (
    <footer style={{ background: "#0a0f1e", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "72px 0 36px" }}>
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48, marginBottom: 52 }}>
          <div>
            <Logo size={30} textColor="#f0f4f8" />
            <p style={{ fontSize: 13.5, color: "#64748b", marginTop: 16, lineHeight: 1.75, maxWidth: 250 }}>{f.tagline}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              {["𝕏", "in", "gh"].map((s, i) => (
                <a key={i} href="#" style={{
                  width: 34, height: 34, borderRadius: 8,
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#64748b", fontSize: 12, fontWeight: 700, textDecoration: "none",
                  transition: "all .15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,130,246,0.12)"; e.currentTarget.style.color = "#60a5fa"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
                >{s}</a>
              ))}
            </div>
          </div>
          {col(f.product, f.links.product)}
          {col(f.company, f.links.company)}
          {col(f.legal, f.links.legal)}
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 13, color: "#475569" }}>{f.copy}</p>
          <a href={APP_URL} style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            textDecoration: "none", background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)", color: "#e2e8f0",
            transition: "all .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.10)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          >Acceder a la app <IconArrow /></a>
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
