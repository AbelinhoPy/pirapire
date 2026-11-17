========================================================================
PIRAPIRE DESKTOP v1.0.0 PARA WINDOWS 64-BIT
Terminal de Monitoreo de Señales Breakout y Binance Spot Testnet
Pirapire Technologies S.A. - República del Paraguay
========================================================================

REQUISITOS DEL SISTEMA:
- Sistema Operativo: Windows 10 / Windows 11 (64 bits)
- Entorno de ejecución: Node.js >= 20.0.0 instalado en PATH
- Procesador: Intel Core i3 / AMD Ryzen 3 o superior
- Memoria RAM: Mínimo 2 GB (Consumo medido en prueba: ~45 MB)
- Espacio en disco: 15 MB libres
- Conexión: Internet estable (HTTPS hacia api.binance.com y servidor Pirapire)

INSTRUCCIONES DE INSTALACIÓN Y ARRANQUE:
1. Extraer los archivos del paquete ZIP en una carpeta de tu preferencia (ej. C:\Pirapire).
2. Abrir PowerShell o CMD en la carpeta extraída.
3. Para consultar el estado sin iniciar sesión (Modo Demo):
   node pirapire-cli.js status
4. Para iniciar sesión interactiva con tu cuenta Pirapire Pro:
   node pirapire-cli.js [TU_TOKEN_DE_SESION]
   O ejecutar el archivo por lotes:
   .\iniciar-pirapire.bat
5. La aplicación validará tu licencia con el servidor y conectará con Binance Spot Testnet.

POLÍTICA DE SEGURIDAD Y FONDOS:
- Operaciones con dinero real: DESACTIVADAS POR POLÍTICA DE SEGURIDAD INTERNA.
- Tus claves API nunca se envían al servidor de Pirapire; se conservan localmente en tu PC.
- Pirapire no es custodio ni realiza captación de fondos de terceros.
