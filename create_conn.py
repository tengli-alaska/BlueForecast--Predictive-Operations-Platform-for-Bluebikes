from airflow.models import Connection
from airflow import settings
import json

session = settings.Session()
existing = session.query(Connection).filter(Connection.conn_id == 'google_cloud_dataproc').first()
if existing:
    session.delete(existing)
    session.commit()

conn = Connection(
    conn_id='google_cloud_dataproc',
    conn_type='google_cloud_platform',
    extra=json.dumps({'project': 'bluebikes-demand-predictor'})
)
session.add(conn)
session.commit()
print('Connection created successfully')
