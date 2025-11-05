/**
 * EdForge EMIS - School Avatar Utility
 * 
 * Generates consistent gradient avatars with school initials.
 * Uses purple/pink gradient scheme for enterprise-grade aesthetic.
 */

/**
 * Generate a gradient color pair from a school identifier
 * Uses a hash function to ensure consistent colors for the same school
 */
function generateGradientFromId(identifier: string): { from: string; to: string } {
  // Simple hash function to generate consistent colors
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Purple/pink gradient variations
  const gradients = [
    { from: 'from-purple-500', to: 'to-pink-500' },      // Primary gradient
    { from: 'from-purple-600', to: 'to-rose-500' },      // Variation 1
    { from: 'from-violet-500', to: 'to-pink-600' },      // Variation 2
    { from: 'from-purple-500', to: 'to-fuchsia-500' },   // Variation 3
    { from: 'from-indigo-500', to: 'to-pink-500' },      // Variation 4
    { from: 'from-purple-600', to: 'to-rose-600' },      // Variation 5
  ];

  // Use hash to select a consistent gradient
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

/**
 * Extract initial from school name
 * Returns the first letter, uppercase
 */
export function getSchoolInitial(schoolName: string): string {
  if (!schoolName || schoolName.length === 0) {
    return '?';
  }
  
  // Get first letter, handle multi-word names
  const firstChar = schoolName.trim().charAt(0).toUpperCase();
  return firstChar;
}

/**
 * Get gradient classes for school avatar
 * Returns Tailwind CSS classes for gradient background
 */
export function getSchoolAvatarGradient(schoolId: string): string {
  const gradient = generateGradientFromId(schoolId);
  return `bg-gradient-to-br ${gradient.from} ${gradient.to}`;
}

/**
 * Get inline gradient style for school avatar
 * Returns CSS gradient string for use in style prop
 */
export function getSchoolAvatarGradientStyle(schoolId: string): { background: string } {
  const gradient = generateGradientFromId(schoolId);
  
  // Convert Tailwind classes to actual gradient values
  const gradientMap: Record<string, string> = {
    'from-purple-500': '#a855f7',
    'to-pink-500': '#ec4899',
    'from-purple-600': '#9333ea',
    'to-rose-500': '#f43f5e',
    'from-violet-500': '#8b5cf6',
    'to-pink-600': '#db2777',
    'to-fuchsia-500': '#d946ef',
    'from-indigo-500': '#6366f1',
    'to-rose-600': '#e11d48',
  };

  const fromColor = gradientMap[gradient.from] || '#a855f7';
  const toColor = gradientMap[gradient.to] || '#ec4899';

  return {
    background: `linear-gradient(135deg, ${fromColor} 0%, ${toColor} 100%)`,
  };
}

