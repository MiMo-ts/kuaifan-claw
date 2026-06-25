const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const InviteCode = sequelize.define('InviteCode', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  code: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  createdByName: {
    type: DataTypes.STRING(191),
    allowNull: false
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'used', 'disabled'),
    defaultValue: 'active'
  },
  maxDevices: {
    type: DataTypes.INTEGER,
    defaultValue: 3
  },
  usedBy: {
    type: DataTypes.STRING(191),
    allowNull: true,
    defaultValue: null
  },
  usedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  platform: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: null
  },
  metadata: {
    type: DataTypes.TEXT,
    defaultValue: null,
    get() {
      const value = this.getDataValue('metadata');
      try {
        return value ? JSON.parse(value) : {};
      } catch {
        return {};
      }
    },
    set(value) {
      this.setDataValue('metadata', value ? JSON.stringify(value) : null);
    }
  }
}, {
  tableName: 'invitecodes',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
});

module.exports = InviteCode;
