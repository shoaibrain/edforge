/**
 * School Hours Validation Utility
 *
 * Validates schedule slots, school days, and generates default bell schedule periods.
 * All time values are HH:mm format (24-hour).
 */

export interface SchoolHoursConfig {
  startTime: string;  // HH:mm
  endTime: string;    // HH:mm
  schoolDays: number[];  // 0=Sun..6=Sat
  periodDuration: number;  // minutes
}

export interface Period {
  number: number;
  startTime: string;  // HH:mm
  endTime: string;    // HH:mm
  type: 'class' | 'break';
  label: string;
}

/**
 * Parse HH:mm string to minutes since midnight
 */
function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Format minutes since midnight to HH:mm
 */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Check if a time falls within school hours (inclusive start, exclusive end)
 */
export function isWithinSchoolHours(time: string, startTime: string, endTime: string): boolean {
  const t = parseTime(time);
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  return t >= start && t <= end;
}

/**
 * Check if a day of week is a school day
 */
export function isSchoolDay(dayOfWeek: number, schoolDays: number[]): boolean {
  return schoolDays.includes(dayOfWeek);
}

/**
 * Validate a schedule slot against school hours config.
 * Returns error message string or null if valid.
 */
export function validateScheduleSlot(params: {
  startTime: string;
  endTime: string;
  dayOfWeek: number;
  schoolConfig: SchoolHoursConfig;
}): string | null {
  const { startTime, endTime, dayOfWeek, schoolConfig } = params;

  // Check school day
  if (!isSchoolDay(dayOfWeek, schoolConfig.schoolDays)) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `${dayNames[dayOfWeek]} is not a school day`;
  }

  // Check start time
  if (!isWithinSchoolHours(startTime, schoolConfig.startTime, schoolConfig.endTime)) {
    return `Start time ${startTime} falls outside school hours (${schoolConfig.startTime}-${schoolConfig.endTime})`;
  }

  // Check end time
  if (!isWithinSchoolHours(endTime, schoolConfig.startTime, schoolConfig.endTime)) {
    return `End time ${endTime} falls outside school hours (${schoolConfig.startTime}-${schoolConfig.endTime})`;
  }

  // Check order
  if (parseTime(endTime) <= parseTime(startTime)) {
    return `End time ${endTime} must be after start time ${startTime}`;
  }

  return null;
}

/**
 * Auto-generate bell schedule periods based on school hours and period duration.
 * Inserts breaks between periods.
 */
export function generateDefaultPeriods(
  startTime: string,
  endTime: string,
  periodDuration: number,
  breakDuration: number = 10,
): Period[] {
  const periods: Period[] = [];
  let currentTime = parseTime(startTime);
  const schoolEnd = parseTime(endTime);
  let periodNumber = 1;

  while (currentTime + periodDuration <= schoolEnd) {
    // Add class period
    periods.push({
      number: periodNumber,
      startTime: formatTime(currentTime),
      endTime: formatTime(currentTime + periodDuration),
      type: 'class',
      label: `Period ${periodNumber}`,
    });

    currentTime += periodDuration;
    periodNumber++;

    // Add break if there's room for another period after break
    if (currentTime + breakDuration + periodDuration <= schoolEnd) {
      periods.push({
        number: periodNumber - 1, // breaks share the preceding period number
        startTime: formatTime(currentTime),
        endTime: formatTime(currentTime + breakDuration),
        type: 'break',
        label: periodNumber === 5 ? 'Lunch Break' : 'Break',
      });
      currentTime += breakDuration;
    }
  }

  return periods;
}

/**
 * Validate a bell schedule against school hours.
 * Returns array of error messages (empty if valid).
 */
export function validateBellSchedule(
  periods: Period[],
  schoolConfig: SchoolHoursConfig,
): string[] {
  const errors: string[] = [];
  const classPeriods = periods.filter(p => p.type === 'class');

  if (classPeriods.length === 0) {
    errors.push('Bell schedule must have at least one class period');
    return errors;
  }

  // First period must not start before school start
  const firstPeriod = classPeriods[0];
  if (parseTime(firstPeriod.startTime) < parseTime(schoolConfig.startTime)) {
    errors.push(`First period starts at ${firstPeriod.startTime}, before school start time ${schoolConfig.startTime}`);
  }

  // Last period must not end after school end
  const lastPeriod = classPeriods[classPeriods.length - 1];
  if (parseTime(lastPeriod.endTime) > parseTime(schoolConfig.endTime)) {
    errors.push(`Last period ends at ${lastPeriod.endTime}, after school end time ${schoolConfig.endTime}`);
  }

  // Check period duration alignment (warning-level, not error)
  for (const period of classPeriods) {
    const duration = parseTime(period.endTime) - parseTime(period.startTime);
    if (duration !== schoolConfig.periodDuration && duration !== schoolConfig.periodDuration * 2) {
      // Allow single or double periods
      errors.push(`Period ${period.number} duration (${duration}min) doesn't match configured period duration (${schoolConfig.periodDuration}min)`);
    }
  }

  return errors;
}
