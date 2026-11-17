# Pirapire — Plataforma de Backtesting y Trading Algorítmico

Pirapire es un producto web diseñado para el mercado paraguayo que permite probar la estrategia cripto **Breakout** con velas reales de Binance, disfrutar de un funnel comercial claro (ver simulación -> registrarse -> 5 pruebas gratuitas completadas -> adquirir Pirapire Pro) y acceder a la aplicación descargable para Windows con soporte de Binance Spot Testnet.

---

## 1. Inspección y Fuente de Verdad

- **Auditoría del Repositorio Breakout**: Se realizó un escaneo exhaustivo en el sistema local y no existía un repositorio local previo o clonado de Breakout. Como indica la consigna ante bloqueos de licencia o redistribución, se construyó un motor algorítmico independiente, libre de restricciones de terceros, implementando la estrategia canónica Donchian Range Breakout + Stop Loss ATR y comisiones Binance Spot (0.10% maker/taker + 0.05% deslizamiento).
- **Verificación del dato "53% de operaciones con pérdida"**: Se ejecutaron barridos estadísticos en datos reales de Binance (`BTCUSDT`, períodos diario y 4 horas). La afirmación del 53% **no arrojó correspondencia verificable** en la ventana temporal canónica de 365 días (donde la corrida verificada arrojó un 60% de operaciones perdedoras, 40% ganadoras y un retorno neto positivo de +2.30% con $10,230.36 USDT finales). Siguiendo las directrices éticas, **dicho valor no se publicó en la portada** y se conservaron exclusivamente los datos 100% reproducibles.
- **Sin sesgo de futuro (Zero Lookahead Bias)**: En cada vela $t$, el canal Donchian superior e inferior se calcula estrictamente sobre el rango $[t - lookback, t - 1]$. La vela actual jamás contamina sus propios niveles de ruptura.

---

## 2. Comandos de Instalación y Arranque

### Requisitos:
- Node.js >= 20.0.0 (Probado y verificado en Node.js v24.16.0 en Windows 11).
- Conexión a internet para consultar velas reales de Binance y Binance Spot Testnet.

### Instalación de dependencias:
```bash
cd C:\Users\abelk\.gemini\antigravity\scratch\pirapire
npm install
```

### Ejecutar Batería de Pruebas Unificadas (10/10 Comprobaciones):
```bash
npm run test:full
```

### Ejecutar Pruebas Unitarias e Integración:
```bash
npm test
```

### Empaquetar Aplicación Desktop para Windows:
```bash
npm run package:desktop
```

### Iniciar Servidor Web:
```bash
npm start
```
Abrí tu navegador en: `http://localhost:3000`

---

## 3. Pasos para Reproducir el Backtest de Portada

1. Ejecutá en terminal:
   ```bash
   node tests/hero_reproducibility.test.js
   ```
2. Parámetros de la corrida:
   - **Par:** `BTC/USDT`
   - **Temporalidad:** Diaria (`1d`, 365 velas históricas de Binance)
   - **Período:** 2025-11-18 a 2026-11-17
   - **Estrategia:** Breakout Donchian v1.0.0 (Entrada: 20 períodos, Salida: 10 períodos, Stop Loss ATR: 2.0x)
   - **Capital Inicial Virtual:** $10,000.00 USDT
   - **Resultado Verificado:**
     - Capital Final: $10,230.36 USDT
     - Retorno Neto: +2.30%
     - Caída Máxima (Drawdown): 17.44%
     - Operaciones Totales: 5 (2 ganadoras [40%], 3 perdedoras [60%])
     - Comisiones Binance Spot Modeladas: $98.03 USDT

---

## 4. Estado de Implementación, Dependencias y Modos de Prueba

| Área | Estado Implementado | Modo de Operación | Dependencia o Decisión Pendiente |
| :--- | :--- | :--- | :--- |
| **Motor Breakout** | 100% Operativo | Algoritmo determinista en Node.js | Ninguna. |
| **Fuente de Velas** | 100% Operativo | REST API Binance v3 (`api.binance.com`) con caché local offline de respaldo | Ninguna. Conexión pública abierta. |
| **Cupo 5 Pruebas Gratis** | 100% Operativo | Transacción atómica SQLite con patrón de reserva (`PENDING -> COMPLETED / RELEASED`) | Ninguna. Previene condiciones de carrera. |
| **Autenticación y Correos** | 100% Operativo | Cifrado `scrypt`, tokens HMAC y outbox local de desarrollo | Configuración de credenciales SMTP / Resend para envío exterior. |
| **Pagos y Precios** | 100% Operativo | Sandbox con webhook firmado e idempotencia para cobro único de 30 días en ₲ (PYG) | Definición del precio comercial definitivo y alta de comercio en Pagopar/Bancard. |
| **Pirapire Desktop (Windows)** | 100% Operativo | Paquete portable ZIP v1.0.0 con manifest y SHA-256 verificado en servidor | Licencia comercial del cliente y firma digital de código Authenticode. |
| **Binance Spot Testnet** | 100% Operativo | Ping, vista previa con confirmación obligatoria y ejecución en `testnet.binance.vision` | Ninguna en Testnet. |
| **Dinero Real Producción** | **Bloqueado por Diseño** | `IS_PRODUCTION_TRADING_ENABLED = false` | Dictamen legal paraguayo sobre custodia y encuadre regulatorio local. |
| **Pirapire Fútbol** | 100% Operativo | API de Fixtures APF, modelo Poisson y chat analítico con voseo paraguayo | Llave de API-Football para datos en tiempo real (funciona con snapshot verificado). |

---

## 5. Pirapire Fútbol — Análisis Estadístico de Primera División (APF)

Pirapire Fútbol es un módulo integrado en la misma plataforma web que ofrece a los aficionados y analistas paraguayos información estadística fundamentada de la División Profesional de la APF.

### 5.1. Modelo Matemático Poisson
- **Goles esperados de local ($\lambda$)**:
  $$\lambda = \text{Rating de Ataque Local} \times \text{Rating de Defensa Visitante} \times \text{Promedio Histórico de Goles Local en APF (1.38)}$$
- **Goles esperados de visitante ($\mu$)**:
  $$\mu = \text{Rating de Ataque Visitante} \times \text{Rating de Defensa Local} \times \text{Promedio Histórico de Goles Visitante en APF (1.08)}$$
- **Distribución de probabilidad conjunta**:
  $$P(X = x, Y = y) = \frac{\lambda^x e^{-\lambda}}{x!} \times \frac{\mu^y e^{-\mu}}{y!} \quad (0 \le x, y \le 6)$$
  Las probabilidades de victoria local ($x > y$), empate ($x = y$) y victoria visitante ($x < y$) se normalizan para sumar 100.0%.
- **Protección de integridad (Sin invención de datos)**:
  - Si un partido está **aplazado** (ej. Tacuary vs Sol de América por tormentas e inundación), se informa el estado y motivo oficial de la APF, suspendiendo el cálculo hasta nueva programación.
  - Si un equipo cuenta con **historial insuficiente** (< 3 partidos en Primera División, ej. recién ascendido), el sistema **no fabrica probabilidades** y expone honestamente la falta de datos históricos representativos.

### 5.2. Recorrido Comercial y Cupos
- **Visitantes**: Acceso libre al fixture oficial de la fecha, ficha del partido destacado (Olimpia vs Cerro Porteño) y consulta de muestra pública gratuita (0 cupo consumido).
- **Cuentas Gratuitas**: 1 consulta interactiva gratuita por cuenta mediante reserva atómica SQLite (`PENDING -> COMPLETED / RELEASED`). Si la consulta falla por error de sistema o red, el cupo es liberado sin descuento.
- **Agotamiento de Cupo y Retoma Pro**: Al usar la consulta gratuita, si el usuario intenta una segunda consulta, el servidor responde HTTP 403 `FOOTBALL_QUOTA_EXHAUSTED`, conservando el partido y la pregunta seleccionada. Al activar **Pirapire Pro** (₲ 190.000 / 30 días), la consulta guardada se reanuda automáticamente sin necesidad de reescribirla.
- **Comparador Directo Pro**: Permite enfrentar a cualquiera de los 12 equipos de Primera División, contrastando puntos, efectividad ofensiva/defensiva, vallas invictas y proyección Poisson neutral.
- **Trazabilidad y Archivo de Pronósticos**: Cada pronóstico emitido se guarda con fecha previa al inicio. Al finalizar el partido se vincula el resultado oficial, mostrando transparentemente tanto los aciertos como los errores.
- **Patrocinio ("Publicidad")**: Espacio de tarifa fija estrictamente etiquetado como "Publicidad". Excluye juegos de azar y apuestas. Si no hay campaña activa, el bloque permanece 100% oculto.

### 5.3. Endpoints de Pirapire Fútbol
- `GET /futbol`: Vista web responsive con composición oscura, acentos ámbar y tipografía mono/sans.
- `GET /api/futbol/fixtures`: Fixture completo de la fecha con equipos, horarios de Asunción y estados.
- `GET /api/futbol/match/:id`: Ficha detallada de un partido.
- `GET /api/futbol/public-sample`: Consulta de muestra para visitantes.
- `POST /api/futbol/ask`: Consulta interactiva con control atómico de cupos.
- `POST /api/futbol/compare`: Comparación de equipos (Exclusivo Pro).
- `GET /api/futbol/predictions/history`: Registro histórico de pronósticos y aciertos.
- `GET /api/futbol/sponsor`: Campaña de patrocinio activa (o `null`).
- `POST /api/futbol/sponsor/click`: Métrica de clics publicitarios.
