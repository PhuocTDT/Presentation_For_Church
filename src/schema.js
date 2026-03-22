const SongSchema = {
  required: ['id', 'title', 'lyrics'],
  defaults: {
    type: 'song', // default type
    style: { fontSize: 36, fontColor: '#ffffff', textAlign: 'center' },
    background: null // null means use default background
  }
};

function validateItem(data) {
  const errors = [];
  if (data.id === undefined || data.id === null) errors.push('Missing id');
  if (!data.title || typeof data.title !== 'string' || !data.title.trim()) errors.push('Missing title');
  if (typeof data.lyrics !== 'string') errors.push('Missing lyrics');
  return { valid: errors.length === 0, errors };
}

function migrateItem(data) {
  // Ensure the object has all default fields if they are missing
  const migrated = { ...SongSchema.defaults, ...data };
  
  // Ensure style object has defaults if partially provided
  if (migrated.style) {
    migrated.style = { ...SongSchema.defaults.style, ...migrated.style };
  }
  
  return migrated;
}

module.exports = { validateItem, migrateItem, SongSchema };
