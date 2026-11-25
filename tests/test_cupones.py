import os
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import text


class TestCupones(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, DATABASE_URL='sqlite:///:memory:', SECRET_KEY='test-cupones'):
            from app import create_app
            cls.app = create_app()
        cls.app.config['TESTING'] = True

    def setUp(self):
        from database import db, Rol, Sede, Turno, Usuario
        self.db = db
        with self.app.app_context():
            db.drop_all()
            db.create_all()
            db.session.add_all([
                Rol(id_rol=1, nombre_rol='admin_general'),
                Rol(id_rol=2, nombre_rol='admin_sala'),
                Sede(id_sede=1, nombre_sede='Sede real'),
                Turno(id_turno='NA', nombre_turno='N/A'),
                Usuario(id_usuario='admin', username='admin', password_hash='unused', id_rol=1, id_sede=1, id_turno='NA'),
                Usuario(id_usuario='sala', username='sala', password_hash='unused', id_rol=2, id_sede=1, id_turno='NA'),
            ])
            db.session.commit()
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session['_user_id'] = 'admin'
            session['_fresh'] = True
            session['_csrf_token'] = 'test-token'

    def test_create_lookup_and_redeem(self):
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        response = self.client.post('/api/crear', json={'monto': 50, 'cantidad': 1, 'fecha_vencimiento': tomorrow}, headers={'X-CSRFToken': 'test-token'})
        self.assertEqual(response.status_code, 200)
        code = response.get_json()['cupones'][0]['codigo']
        self.assertEqual(self.client.get('/api/cupon/' + code).get_json()['coupon']['estado'], 'disponible')
        redeemed = self.client.post('/api/canjear', json={'codigo': code}, headers={'X-CSRFToken': 'test-token'})
        self.assertEqual(redeemed.status_code, 200)
        self.assertEqual(redeemed.get_json()['coupon']['estado'], 'utilizado')

    def test_sala_has_access_and_invalid_amount_is_rejected(self):
        with self.client.session_transaction() as session:
            session['_user_id'] = 'sala'
        response = self.client.post('/api/crear', json={'monto': 10, 'cantidad': 1, 'fecha_vencimiento': date.today().isoformat()}, headers={'X-CSRFToken': 'test-token'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get('/cupones').status_code, 200)
