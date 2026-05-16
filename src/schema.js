const SongSchema = {
  required: ['id', 'title', 'lyrics'],
  defaults: {
    type: 'song', // default type
    style: {
      fontFamily: 'CMG Sans',
      fontSize: '80px',
      color: '#ffffff',
      textAlign: 'center',
      verticalAlign: 'middle',
      textStrokeWidth: 5,
      textStrokeColor: '#000000',
      textMargin: { top: 0, right: 0, bottom: 0, left: 0 },
      textPadding: { top: 0, right: 0, bottom: 0, left: 0 },
      boxStyle: {
        enabled: false,
        backgroundColor: '#000000',
        backgroundOpacity: 0.35,
        borderColor: '#ffffff',
        borderWidth: 0,
        borderStyle: 'solid',
        borderRadius: 0
      },
      textBox: { left: 48, width: 864, top: null }
    },
    background: null // null means use default background
  }
};

function validateItem(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    errors.push('Invalid item');
    return { valid: false, errors };
  }
  if (data.id === undefined || data.id === null) errors.push('Missing id');
  if (!data.title || typeof data.title !== 'string' || !data.title.trim()) errors.push('Missing title');
  if (typeof data.lyrics !== 'string') errors.push('Missing lyrics');
  if (data.type != null && data.type !== 'song' && data.type !== 'bible') errors.push('Invalid type');
  return { valid: errors.length === 0, errors };
}

function migrateItem(data) {
  const source = (data && typeof data === 'object') ? data : {};
  const migrated = { ...SongSchema.defaults, ...source };

  if (migrated.type !== 'song' && migrated.type !== 'bible') {
    migrated.type = SongSchema.defaults.type;
  }

  if (migrated.style) {
    migrated.style = { ...SongSchema.defaults.style, ...migrated.style };

    // Normalize legacy field: fontColor → color
    if (migrated.style.fontColor && !migrated.style.color) {
      migrated.style.color = migrated.style.fontColor;
    }
    delete migrated.style.fontColor;

    // Normalize fontSize: plain number → 'px', legacy 'pt' → 'px'
    if (typeof migrated.style.fontSize === 'number') {
      migrated.style.fontSize = migrated.style.fontSize + 'px';
    } else if (typeof migrated.style.fontSize === 'string' && migrated.style.fontSize.endsWith('pt')) {
      migrated.style.fontSize = Math.round(parseFloat(migrated.style.fontSize) * 2 / 3) + 'px';
    }

    if (!migrated.style.textBox || typeof migrated.style.textBox !== 'object') {
      migrated.style.textBox = { ...SongSchema.defaults.style.textBox };
    } else {
      migrated.style.textBox = {
        ...SongSchema.defaults.style.textBox,
        ...migrated.style.textBox
      };
    }

    if (!migrated.style.textMargin || typeof migrated.style.textMargin !== 'object') {
      migrated.style.textMargin = { ...SongSchema.defaults.style.textMargin };
    } else {
      migrated.style.textMargin = {
        ...SongSchema.defaults.style.textMargin,
        ...migrated.style.textMargin
      };
    }

    if (!migrated.style.textPadding || typeof migrated.style.textPadding !== 'object') {
      migrated.style.textPadding = { ...SongSchema.defaults.style.textPadding };
    } else {
      migrated.style.textPadding = {
        ...SongSchema.defaults.style.textPadding,
        ...migrated.style.textPadding
      };
    }

    if (!migrated.style.boxStyle || typeof migrated.style.boxStyle !== 'object') {
      migrated.style.boxStyle = { ...SongSchema.defaults.style.boxStyle };
    } else {
      migrated.style.boxStyle = {
        ...SongSchema.defaults.style.boxStyle,
        ...migrated.style.boxStyle
      };
    }
  }

  if (!migrated.background || typeof migrated.background !== 'object') {
    migrated.background = null;
  }

  return migrated;
}

module.exports = { validateItem, migrateItem, SongSchema };
