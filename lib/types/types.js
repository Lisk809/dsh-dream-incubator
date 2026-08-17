/**
 * dsh-dream-incubator domain vocabulary: dream records, style matrix
 * identities, PAD emotion vectors, and validated plugin configuration.
 *
 * @module dsh-dream-incubator/types
 */
/** Brand a string as a {@link DreamId}. */
export function DreamId(id) {
    return id;
}
/** The six built-in dream styles of the style matrix (plan §3.2-②). */
export const DREAM_STYLES = [
    'cyberpunk',
    'fantasy',
    'noir',
    'surreal',
    'fable',
    'horror',
];
