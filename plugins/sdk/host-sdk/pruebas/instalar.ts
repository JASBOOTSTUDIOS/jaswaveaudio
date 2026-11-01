/**
 * Solo pruebas: importar este archivo (el primero) instala el runtime del DAW real, de modo que los imports
 * siguientes de código de módulos (que usan @jaswave/host-sdk) ya lo encuentran.
 */
import { instalarHostReal } from './host-real'

instalarHostReal()
